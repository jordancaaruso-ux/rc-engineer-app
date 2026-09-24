import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { requireApiFeature } from "@/lib/entitlementGuards";
import { checkAiBudget, recordEstimatedAiUsage } from "@/lib/aiUsage/ledger";
import { SETUP_INTERPRET_ESTIMATED_COST_USD } from "@/lib/aiUsage/budgets";
import { hasOpenAiApiKey, getOpenAiApiKey } from "@/lib/openaiServerEnv";
import { prisma } from "@/lib/prisma";
import { isA800RRCar } from "@/lib/setupSheetTemplateId";
import { A800RR_SETUP_SHEET_V1 } from "@/lib/a800rrSetupTemplate";
import { getGenericSetupSheetTemplate } from "@/lib/setupSheetModels/genericSetupSheetTemplate";
import { buildCatalogFromTemplate } from "@/lib/setupFieldCatalog";
import { normalizeSetupData, type SetupSnapshotData } from "@/lib/runSetup";
import { isDerivedSetupKey } from "@/lib/setupCalculations/a800rrDerived";
import { getCalibrationFieldKind } from "@/lib/setupCalibrations/calibrationFieldCatalog";

export const dynamic = "force-dynamic";

const MAX_CHANGES_TEXT = 2000;

type EditProposal = {
  fieldKey: string;
  fieldLabel: string;
  fromValue: string;
  toValue: string;
  confidence: "low" | "medium" | "high";
  note?: string | null;
};

function toScalarString(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "string") return v.trim();
  return "";
}

function mustKey(): string {
  const k = getOpenAiApiKey();
  if (!k) throw new Error("OPENAI_API_KEY is not set");
  return k;
}

export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  if (!hasOpenAiApiKey()) {
    return NextResponse.json({ error: "OPENAI_API_KEY is not set" }, { status: 500 });
  }

  // A paid plan and the AI allowance (2026-09-24 launch audit): before that any signed-in account,
  // unpaid included, could loop this with text of any length against the founder's OpenAI bill.
  const gate = await requireApiFeature("logging");
  if (gate.response) return gate.response;
  const user = gate.user;
  const body = (await request.json().catch(() => null)) as
    | { carId?: unknown; setupData?: unknown; changesText?: unknown }
    | null;

  const carId = typeof body?.carId === "string" ? body.carId.trim() : "";
  // A driver's change note is a line or two; a page of it is not a note.
  const changesText =
    typeof body?.changesText === "string" ? body.changesText.trim().slice(0, MAX_CHANGES_TEXT) : "";
  if (!carId) return NextResponse.json({ error: "carId is required" }, { status: 400 });
  if (!changesText) return NextResponse.json({ error: "changesText is required" }, { status: 400 });

  const budget = await checkAiBudget({
    userId: user.id,
    userEmail: user.email,
    feature: "setup-interpret",
  });
  if (!budget.ok) return NextResponse.json({ error: budget.message }, { status: 429 });

  const car = await prisma.car.findFirst({
    where: { id: carId, userId: user.id },
    select: { setupSheetTemplate: true },
  });
  if (!car) return NextResponse.json({ error: "Car not found" }, { status: 404 });

  const template = isA800RRCar(car.setupSheetTemplate) ? A800RR_SETUP_SHEET_V1 : getGenericSetupSheetTemplate();
  const catalog = buildCatalogFromTemplate(template);

  const setup = normalizeSetupData(body?.setupData) as SetupSnapshotData;
  const allowed = catalog
    .filter((f) => !isDerivedSetupKey(f.key))
    .map((f) => {
      // Tell the LLM what kind of scalar each field expects so it doesn't truncate
      // a full preset name like "Wolverine .4" down to just ".4" (seen in the wild
      // when the model decides a trailing decimal is the "numeric" change).
      const kind = getCalibrationFieldKind(f.key);
      const expects: "number" | "text" =
        kind === "number" || kind === "paired" ? "number" : "text";
      return {
        fieldKey: f.key,
        fieldLabel: f.label,
        unit: f.unit ?? "",
        expects,
        currentValue: toScalarString(setup[f.key]),
      };
    })
    .filter((f) => f.fieldKey && f.fieldLabel);

  // Keep prompt compact: only send keys that have a current scalar value or look likely to be edited.
  const allowedCompact = allowed.slice(0, 240);

  const system = `You convert RC touring car setup change notes into explicit, reviewable setup edits.

CRITICAL SAFETY:
- Propose edits only; do not apply anything.
- If unsure, return no edits.
- Only use the provided fields list. Never invent field keys.
- Only propose scalar edits (numbers or short strings). Do NOT propose arrays, multi-selects, screws, or derived fields.
- Use conservative confidence.

Return ONLY JSON with this shape:
{
  "edits": [
    {
      "fieldKey": string,
      "toValue": string,
      "confidence": "low" | "medium" | "high",
      "note": string | null
    }
  ]
}

Rules:
- If the user says "+0.5 rear camber", compute new value from currentValue when it is numeric; otherwise return no edit.
- If the user says "softer rear spring" but no numeric direction is possible, return no edit unless a clear numeric mapping exists in currentValue.
- Each field has an "expects" tag ("number" or "text"):
  - For "text" fields (body shells, wings, tires, motors, ESCs, etc.), the \`toValue\`
    MUST be the full descriptive string the user wrote (e.g. "Wolverine .4",
    NOT just ".4"). Preserve brand + version together.
  - For "number" fields, \`toValue\` must be a plain number string (no units).
- Prefer returning fewer edits rather than guessing.`;

  const apiKey = mustKey();
  await recordEstimatedAiUsage({
    userId: user.id,
    feature: "setup-interpret",
    estimatedCostUsd: SETUP_INTERPRET_ESTIMATED_COST_USD,
  });
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: JSON.stringify({ changesText, fields: allowedCompact }),
        },
      ],
    }),
  });

  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const msg = (json.error as { message?: string } | undefined)?.message || `OpenAI error (${res.status})`;
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const content =
    (json.choices as Array<{ message?: { content?: string } }> | undefined)?.[0]?.message?.content?.trim() ?? "";
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(content);
  } catch {
    return NextResponse.json({ edits: [] });
  }

  const editsRaw = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>).edits : null;
  const edits = Array.isArray(editsRaw) ? editsRaw : [];
  const allowedMap = new Map(allowed.map((f) => [f.fieldKey, f]));

  const out: EditProposal[] = [];
  for (const e of edits) {
    if (!e || typeof e !== "object") continue;
    const o = e as Record<string, unknown>;
    const fieldKey = typeof o.fieldKey === "string" ? o.fieldKey.trim() : "";
    const toValue = typeof o.toValue === "string" ? o.toValue.trim() : "";
    const confidence = o.confidence === "high" || o.confidence === "medium" || o.confidence === "low" ? (o.confidence as "low" | "medium" | "high") : "low";
    const note = typeof o.note === "string" ? o.note : null;
    if (!fieldKey || !toValue) continue;
    const meta = allowedMap.get(fieldKey);
    if (!meta) continue;
    // Hard safety: derived keys are never allowed.
    if (isDerivedSetupKey(fieldKey)) continue;
    // Hard safety: a "text" field (bodyshell, wing, motor, tires, etc.) must not
    // be written with a bare numeric / decimal token. The LLM occasionally
    // truncates "Wolverine .4" → ".4"; reject those proposals so the user isn't
    // shown a useless diff like `Twister → .4`.
    if (meta.expects === "text" && /^[.,]?\d+(?:[.,]\d+)?$/.test(toValue)) {
      continue;
    }
    out.push({
      fieldKey,
      fieldLabel: meta.fieldLabel,
      fromValue: meta.currentValue,
      toValue,
      confidence,
      note,
    });
  }

  return NextResponse.json({ edits: out.slice(0, 20) });
}

