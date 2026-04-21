import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import {
  PARAMETER_CLASSIFICATION_OVERRIDES,
  getParameterClassificationOverride,
} from "@/lib/setupAggregations/parameterClassificationOverrides";

type TopEntry = { value: string; count: number };

type NumericSurfaceSummary = {
  trackSurface: string;
  sampleCount: number;
  min: number;
  median: number;
  max: number;
  mean: number;
  stdDev: number | null;
};

type ParameterRow = {
  parameterKey: string;
  valueType: "NUMERIC" | "CATEGORICAL" | "BOOLEAN" | "MULTI_SELECT" | "MIXED";
  override: "numeric" | "categorical" | null;
  totalSamples: number;
  surfaces: string[];
  distinctCount: number | null;
  looksNumeric: boolean;
  numericSummary: {
    min: number;
    median: number;
    max: number;
    mean: number;
    stdDev: number | null;
  } | null;
  numericBySurface: NumericSurfaceSummary[];
  topValues: TopEntry[];
};

function looksNumericToken(s: string): boolean {
  const t = s.trim();
  if (!t) return false;
  const n = Number(t.replace(/,/g, "."));
  return Number.isFinite(n);
}

export async function GET() {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }

  // Parameter audit uses the `any` grip bucket only. Every eligible doc contributes there, so sample
  // counts are not triple-counted across low/medium/high. (Grip-specific stats are exposed separately
  // via /api/setup-aggregations/grip-archetypes and the Engineer context.)
  const rows = await prisma.communitySetupParameterAggregation.findMany({
    where: { gripLevel: "any" },
    orderBy: [{ parameterKey: "asc" }, { trackSurface: "asc" }],
    select: {
      parameterKey: true,
      trackSurface: true,
      valueType: true,
      sampleCount: true,
      numericStatsJson: true,
      categoricalStatsJson: true,
    },
  });

  const byKey = new Map<string, ParameterRow>();
  for (const r of rows) {
    let cur = byKey.get(r.parameterKey);
    if (!cur) {
      cur = {
        parameterKey: r.parameterKey,
        valueType: r.valueType as ParameterRow["valueType"],
        override: getParameterClassificationOverride(r.parameterKey) ?? null,
        totalSamples: 0,
        surfaces: [],
        distinctCount: null,
        looksNumeric: false,
        numericSummary: null,
        numericBySurface: [],
        topValues: [],
      };
      byKey.set(r.parameterKey, cur);
    } else if (cur.valueType !== r.valueType) {
      cur.valueType = "MIXED";
    }
    cur.surfaces.push(`${r.trackSurface}:${r.valueType}:${r.sampleCount}`);
    cur.totalSamples += r.sampleCount;

    if (r.valueType === "NUMERIC") {
      const s = (r.numericStatsJson ?? null) as
        | { min: number; median: number; max: number; mean: number; stdDev?: number | null }
        | null;
      if (s) {
        cur.numericBySurface.push({
          trackSurface: r.trackSurface,
          sampleCount: r.sampleCount,
          min: s.min,
          median: s.median,
          max: s.max,
          mean: s.mean,
          stdDev: s.stdDev ?? null,
        });
      }
    } else if (r.valueType === "MULTI_SELECT") {
      const tdf = ((r.categoricalStatsJson ?? {}) as { tokenDocumentFrequency?: Record<string, number> })
        .tokenDocumentFrequency ?? {};
      for (const [k, v] of Object.entries(tdf)) {
        const existing = cur.topValues.find((t) => t.value === k);
        if (existing) existing.count += v;
        else cur.topValues.push({ value: k, count: v });
      }
    } else {
      const freq = ((r.categoricalStatsJson ?? {}) as { frequencies?: Record<string, number> })
        .frequencies ?? {};
      for (const [k, v] of Object.entries(freq)) {
        const existing = cur.topValues.find((t) => t.value === k);
        if (existing) existing.count += v;
        else cur.topValues.push({ value: k, count: v });
      }
    }
  }

  const out: ParameterRow[] = [];
  for (const row of byKey.values()) {
    row.topValues.sort((a, b) => b.count - a.count);
    row.distinctCount = row.valueType === "NUMERIC" ? null : row.topValues.length;
    if (row.numericBySurface.length > 0) {
      const totalSamples = row.numericBySurface.reduce((acc, s) => acc + s.sampleCount, 0);
      const weightedMin = Math.min(...row.numericBySurface.map((s) => s.min));
      const weightedMax = Math.max(...row.numericBySurface.map((s) => s.max));
      const weightedMean =
        row.numericBySurface.reduce((acc, s) => acc + s.mean * s.sampleCount, 0) /
        Math.max(1, totalSamples);
      const medianSurface =
        row.numericBySurface.slice().sort((a, b) => b.sampleCount - a.sampleCount)[0] ??
        row.numericBySurface[0];
      row.numericSummary = {
        min: weightedMin,
        median: medianSurface ? medianSurface.median : 0,
        max: weightedMax,
        mean: weightedMean,
        stdDev: medianSurface ? medianSurface.stdDev : null,
      };
    }
    row.numericBySurface.sort((a, b) => a.trackSurface.localeCompare(b.trackSurface));
    if (row.valueType !== "NUMERIC" && row.valueType !== "MULTI_SELECT") {
      const total = row.topValues.reduce((acc, t) => acc + t.count, 0);
      const numericLike = row.topValues
        .filter((t) => looksNumericToken(t.value))
        .reduce((acc, t) => acc + t.count, 0);
      row.looksNumeric = total > 0 && numericLike / total >= 0.6;
    }
    row.topValues = row.topValues.slice(0, 10);
    out.push(row);
  }

  out.sort((a, b) => {
    const score = (r: ParameterRow) => {
      if (r.override === "numeric") return 0;
      if (r.override === "categorical") return 1;
      if (r.valueType === "CATEGORICAL" && r.looksNumeric) return 2;
      if (r.valueType === "NUMERIC") return 3;
      if (r.valueType === "CATEGORICAL") return 4;
      if (r.valueType === "BOOLEAN") return 5;
      if (r.valueType === "MULTI_SELECT") return 6;
      return 7;
    };
    const sa = score(a);
    const sb = score(b);
    if (sa !== sb) return sa - sb;
    return a.parameterKey.localeCompare(b.parameterKey);
  });

  const counts = {
    total: out.length,
    numeric: out.filter((r) => r.valueType === "NUMERIC").length,
    categorical: out.filter((r) => r.valueType === "CATEGORICAL").length,
    boolean: out.filter((r) => r.valueType === "BOOLEAN").length,
    multiSelect: out.filter((r) => r.valueType === "MULTI_SELECT").length,
    mixed: out.filter((r) => r.valueType === "MIXED").length,
    categoricalButLooksNumeric: out.filter((r) => r.valueType === "CATEGORICAL" && r.looksNumeric).length,
    withOverride: out.filter((r) => r.override != null).length,
  };

  return NextResponse.json({
    overrides: PARAMETER_CLASSIFICATION_OVERRIDES,
    counts,
    parameters: out,
  });
}
