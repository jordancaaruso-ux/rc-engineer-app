"use client";

/**
 * Dev preview for chassis onboarding — drop a manufacturer's blank, fillable setup sheet and see
 * the sheet the pipeline would propose (`src/lib/chassisOnboarding/proposeSheet.ts`).
 *
 * The question this page exists to answer is the one from the eval script: onboarding a chassis by
 * hand means authoring every field, so does the deterministic pass leave a human 25 decisions or
 * 180? The CLI (`npm run chassis-onboarding:eval`) answers it for four fixed sheets; this answers
 * it for whatever PDF is in front of you, which is the only way to learn how many chassis in the
 * wild are actually onboardable.
 *
 * It splits the leftovers where the CLI does not. A box with no corpus match but a caption printed
 * beside it on the sheet is NOT the same cost as a box with nothing to go on: one is confirming the
 * manufacturer's own word, the other is naming it from scratch. Counting them together is what made
 * the eval read worse than the pipeline behaves.
 *
 * The honest ceiling, measured 2026-08-06: this works where the manufacturer left the captions as
 * text (Xray X4'26 — 97% of boxes get a name) and collapses where they were flattened to vector
 * outlines (Xray X4'22) or raster (Mugen MTC3). The banner up top names which case you are in,
 * because otherwise a bad result reads as a bad algorithm.
 */

import { notFound } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
// Type-only, deliberately: `proposeSheet` reaches pdfjs and the PDF parsers through its value
// exports, and this is a client component. Importing `groupTitle` from it would drag the whole
// server-side parsing chain into the browser bundle for a string lookup.
import type { ProposedField, SheetProposal } from "@/lib/chassisOnboarding/proposeSheet";
import { SETUP_SHEET_GROUPS, type SetupSheetGroupId } from "@/lib/setupSheetModels/setupSheetGroups";

function groupTitle(id: SetupSheetGroupId): string {
  return SETUP_SHEET_GROUPS.find((g) => g.id === id)?.title ?? "Other";
}

type Result = { fileName: string; proposal: SheetProposal };

/** How a proposed name was arrived at, worst-to-best, with the mark the rows carry. */
const SOURCE_META: Record<
  ProposedField["source"],
  { mark: string; label: string; tone: string; blurb: string }
> = {
  registry: {
    mark: "✓✓",
    label: "Registry",
    tone: "text-emerald-400",
    blurb: "A universal parameter — this box already has a name the whole app agrees on.",
  },
  corpus: {
    mark: "✓",
    label: "Existing sheet",
    tone: "text-emerald-300",
    blurb: "Reuses a label already shipped on another chassis.",
  },
  printed: {
    mark: "·",
    label: "Printed on the sheet",
    tone: "text-amber-300",
    blurb: "No match, but the manufacturer printed a caption beside the box. Confirm the wording.",
  },
  unnamed: {
    mark: "?",
    label: "Nothing to go on",
    tone: "text-red-400",
    blurb: "No match and no caption. Someone has to name this box from scratch.",
  },
};

export default function ChassisOnboardingPreviewPage() {
  // Dev-only — the API route it calls 404s in production too.
  if (process.env.NODE_ENV === "production") notFound();
  return <Preview />;
}

function Preview() {
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  async function onPick(file: File) {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/debug/chassis-onboarding", { method: "POST", body });
      const json = (await res.json()) as Result & { error?: string };
      if (!res.ok) setError(json.error ?? `Failed (${res.status}).`);
      else setResult(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    // The app's own page chrome, not a bare div: this route renders inside AppShell, so a plain
    // container slides under the mobile brand pill at the top and the tab bar at the bottom.
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Chassis onboarding</h1>
          <p className="page-subtitle">
            Drop a manufacturer&apos;s blank, fillable setup sheet. Nothing is saved — the PDF is
            read in memory and dropped.
          </p>
        </div>
      </header>
      <section className="page-body space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onPick(f);
            e.target.value = "";
          }}
        />
        <Button onClick={() => inputRef.current?.click()} disabled={busy}>
          {busy ? "Reading the sheet…" : "Choose a blank sheet PDF"}
        </Button>
        {busy ? <Spinner /> : null}
        {result ? (
          <span className="text-xs text-muted-foreground">{result.fileName}</span>
        ) : null}
      </div>

      {error ? (
        <p className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
          {error}
        </p>
      ) : null}

      {result ? <Report proposal={result.proposal} showAll={showAll} onToggleAll={setShowAll} /> : null}
      </section>
    </>
  );
}

function Report({
  proposal,
  showAll,
  onToggleAll,
}: {
  proposal: SheetProposal;
  showAll: boolean;
  onToggleAll: (v: boolean) => void;
}) {
  const total = proposal.fields.length;
  const by = (s: ProposedField["source"]) => proposal.fields.filter((f) => f.source === s).length;
  const registry = by("registry");
  const corpus = by("corpus");
  const printed = by("printed");
  const unnamed = by("unnamed");

  // The number that decides whether this ships. Matched rows are reviewed as one bulk-accept
  // screen; a printed caption is a one-tap confirm; only `unnamed` is authoring from nothing.
  const accepted = registry + corpus;
  const confirms = printed;

  // Near-zero printed text is the tell that the captions were flattened to outlines or raster —
  // no extractor will ever find them, so a poor result here is the PDF, not the pipeline.
  const textLayer =
    proposal.printedPhraseCount < total * 0.25
      ? {
          tone: "border-red-500/40 bg-red-500/10 text-red-200",
          title: "This sheet has almost no text layer.",
          body:
            `Only ${proposal.printedPhraseCount} printed phrase(s) for ${total} boxes. The captions ` +
            "were flattened to vector outlines or raster, so there is nothing to read beside each " +
            "box. No amount of matching fixes this one — it would need OCR.",
        }
      : proposal.printedPhraseCount < total * 0.7
        ? {
            tone: "border-amber-500/40 bg-amber-500/10 text-amber-200",
            title: "Patchy text layer.",
            body:
              `${proposal.printedPhraseCount} printed phrase(s) for ${total} boxes — part of this ` +
              "sheet is text and part was flattened. Expect the leftovers to cluster in the " +
              "flattened region.",
          }
        : {
            tone: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
            title: "Good text layer.",
            body:
              `${proposal.printedPhraseCount} printed phrase(s) for ${total} boxes — the ` +
              "manufacturer left the captions as real text, which is the case this pipeline is for.",
          };

  const groups = new Map<SetupSheetGroupId, ProposedField[]>();
  for (const f of proposal.fields) {
    const list = groups.get(f.group) ?? [];
    list.push(f);
    groups.set(f.group, list);
  }

  const visible = (fields: ProposedField[]) =>
    showAll ? fields : fields.filter((f) => f.source === "printed" || f.source === "unnamed");

  return (
    <div className="space-y-6">
      <div className={`rounded-lg border p-3 text-sm ${textLayer.tone}`}>
        <p className="font-medium">{textLayer.title}</p>
        <p className="mt-1 opacity-90">{textLayer.body}</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat n={total} label="boxes on the sheet" />
        <Stat n={accepted} label="arrive named — bulk accept" of={total} tone="text-emerald-400" />
        <Stat n={confirms} label="a caption to confirm" of={total} tone="text-amber-300" />
        <Stat n={unnamed} label="named from scratch" of={total} tone="text-red-400" />
      </div>

      <p className="text-sm text-muted-foreground">
        A human walks <strong className="text-foreground">{unnamed}</strong> box
        {unnamed === 1 ? "" : "es"} from nothing and confirms{" "}
        <strong className="text-foreground">{confirms}</strong> proposed caption
        {confirms === 1 ? "" : "s"}, instead of authoring all{" "}
        <strong className="text-foreground">{total}</strong>.
        {proposal.duplicateLabelCount > 0 ? (
          <>
            {" "}
            <span className="text-amber-300">
              {proposal.duplicateLabelCount} name clash
              {proposal.duplicateLabelCount === 1 ? "" : "es"}
            </span>{" "}
            need a human to say which box is which — typically one is the measured value and the
            other the hardware that sets it.
          </>
        ) : null}
      </p>

      {proposal.warnings.length > 0 ? (
        <ul className="list-disc space-y-1 pl-5 text-xs text-amber-300">
          {proposal.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}

      <div className="flex items-center gap-3">
        <Button variant="outline" onClick={() => onToggleAll(!showAll)}>
          {showAll ? "Show only what needs a decision" : `Show all ${total} boxes`}
        </Button>
        <span className="text-xs text-muted-foreground">
          {registry} registry · {corpus} existing sheet · {printed} printed · {unnamed} unnamed
        </span>
      </div>

      <div className="space-y-5">
        {[...groups.entries()].map(([groupId, fields]) => {
          const rows = visible(fields);
          if (rows.length === 0) return null;
          return (
            <section key={groupId} className="space-y-2">
              <h2 className="text-sm font-semibold">
                {groupTitle(groupId)}{" "}
                <span className="font-normal text-muted-foreground">
                  ({rows.length}
                  {showAll ? "" : ` of ${fields.length}`})
                </span>
              </h2>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-[640px] text-left text-xs">
                  <thead className="bg-secondary text-muted-foreground">
                    <tr>
                      <th className="p-2 font-medium">Proposed name</th>
                      <th className="p-2 font-medium">Where it came from</th>
                      <th className="p-2 font-medium">Box in the PDF</th>
                      <th className="p-2 font-medium">Printed caption</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((f) => {
                      const meta = SOURCE_META[f.source];
                      return (
                        <tr key={f.key} className="border-t border-border align-top">
                          <td className="p-2">
                            <span className={`mr-1 ${meta.tone}`}>{meta.mark}</span>
                            <span className={f.source === "unnamed" ? "text-muted-foreground" : ""}>
                              {f.label}
                            </span>
                            {f.unit ? (
                              <span className="ml-1 text-muted-foreground">({f.unit})</span>
                            ) : null}
                            {f.duplicateLabel ? (
                              <span className="ml-2 text-amber-300">⚠ clash</span>
                            ) : null}
                            {f.widgetCount > 1 ? (
                              <span className="ml-2 text-muted-foreground">
                                [{f.widgetCount}-way choice]
                              </span>
                            ) : null}
                          </td>
                          <td className={`p-2 ${meta.tone}`}>{meta.label}</td>
                          <td className="p-2 font-mono text-muted-foreground">{f.acroName}</td>
                          <td className="p-2 text-muted-foreground">{f.printedCaption ?? "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })}
      </div>

      <div className="space-y-1 text-xs text-muted-foreground">
        {(Object.keys(SOURCE_META) as ProposedField["source"][]).map((s) => (
          <p key={s}>
            <span className={`mr-1 ${SOURCE_META[s].tone}`}>{SOURCE_META[s].mark}</span>
            <strong className="text-foreground">{SOURCE_META[s].label}</strong> — {SOURCE_META[s].blurb}
          </p>
        ))}
      </div>
    </div>
  );
}

function Stat({ n, label, of, tone }: { n: number; label: string; of?: number; tone?: string }) {
  return (
    <div className="rounded-lg border border-border bg-secondary p-3">
      <p className={`text-xl font-semibold ${tone ?? ""}`}>
        {n}
        {of ? (
          <span className="ml-1 text-xs font-normal text-muted-foreground">
            {Math.round((n / of) * 100)}%
          </span>
        ) : null}
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
