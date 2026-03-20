"use client";

import { useMemo } from "react";
import { normalizeSetupData, type SetupSnapshotData } from "@/lib/runSetup";
import { A800RR_SETUP_SHEET_V1 } from "@/lib/a800rrSetupTemplate";
import { formatRunSessionDisplay } from "@/lib/runSession";
import { formatRunCreatedAtDateWeekday } from "@/lib/formatDate";

export type A800RRSetupSheetRun = {
  id: string;
  createdAt: Date | string;
  sessionLabel?: string | null;
  sessionType: string;
  meetingSessionType?: string | null;
  meetingSessionCode?: string | null;
  carNameSnapshot?: string | null;
  trackNameSnapshot?: string | null;
  tireRunNumber: number;
  car?: { id: string; name: string } | null;
  track?: { id: string; name: string } | null;
  tireSet?: { id: string; label: string; setNumber: number | null } | null;
  event?: {
    name: string;
    startDate?: Date | string | null;
    endDate?: Date | string | null;
    track?: { name: string } | null;
  } | null;
  setupSnapshot?: { id: string; data: unknown } | null;
};

function fieldValue(data: SetupSnapshotData, key: string): string {
  const x = data[key];
  if (x == null || x === "") return "";
  return String(x).trim();
}

function getBoolFromSetupString(v: string): boolean {
  const s = v.trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

function MetadataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex border-b border-black/20 last:border-b-0">
      <div className="w-24 shrink-0 py-0.5 pr-2 text-[10px] text-black/70 uppercase">{label}</div>
      <div className="min-w-0 flex-1 py-0.5 text-[11px] font-mono">{value}</div>
    </div>
  );
}

export function A800RRSetupSheet({ run, className }: { run: A800RRSetupSheetRun; className?: string }) {
  const setupData: SetupSnapshotData = normalizeSetupData(run.setupSnapshot?.data ?? {});

  const checkboxKeys = useMemo(() => {
    const s = new Set<string>();
    for (const g of A800RR_SETUP_SHEET_V1.groups) {
      for (const f of g.fields) {
        if (f.input === "checkbox") s.add(f.key);
      }
    }
    return s;
  }, []);

  const eventName = run.event?.name ?? "";
  const trackName =
    run.event?.track?.name ?? run.track?.name ?? run.trackNameSnapshot ?? "";
  const dateLabel = run.createdAt ? formatRunCreatedAtDateWeekday(run.createdAt) : "";
  const carName = run.car?.name ?? run.carNameSnapshot ?? "";
  const sessionLabel = run.sessionLabel?.trim() || formatRunSessionDisplay(run);
  const tiresLabel = run.tireSet
    ? `${run.tireSet.label} · Set ${run.tireSet.setNumber ?? "—"} · Run ${run.tireRunNumber}`
    : fieldValue(setupData, "tires_setup") || "";

  return (
    <div
      className={className}
      data-setup-sheet="awesomatix_a800rr"
      style={{ width: "210mm", minHeight: "297mm", boxSizing: "border-box" }}
    >
      {/* Top metadata block – not part of core setup logic, but rendered for export */}
      <div className="border border-black/30 rounded-sm p-2 mb-3 bg-white">
        <div className="text-[9px] text-black/60 uppercase tracking-wider mb-1.5 font-semibold">
          Event / track / date
        </div>
        <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2 text-[11px]">
          <div className="space-y-0">
            <MetadataRow label="Event" value={eventName} />
            <MetadataRow label="Track" value={trackName} />
            <MetadataRow label="Date" value={dateLabel} />
          </div>
          <div className="space-y-0">
            <MetadataRow label="Car" value={carName} />
            <MetadataRow label="Session" value={sessionLabel} />
            <MetadataRow label="Tires" value={tiresLabel} />
          </div>
        </div>
      </div>

      {/* Sheet title */}
      <div className="text-center border-b-2 border-black/30 pb-1.5 mb-3">
        <div className="text-[10px] font-mono text-black/70 uppercase tracking-widest">
          Setup sheet
        </div>
        <div className="text-sm font-semibold">Awesomatix A800RR</div>
      </div>

      {/* Setup sections – app-native structured sheet (not a PDF) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {A800RR_SETUP_SHEET_V1.groups.map((section) => (
          <div
            key={section.id}
            className="rounded border-2 border-black/25 bg-white overflow-hidden"
          >
            <div className="px-2 py-1.5 bg-black/5 border-b border-black/20 text-center text-[10px] font-semibold uppercase tracking-wide font-mono">
              {section.title}
            </div>
            <div className="divide-y divide-black/15">
              {section.fields.map((f) => {
                const raw = fieldValue(setupData, f.key);
                const val =
                  checkboxKeys.has(f.key) && raw !== ""
                    ? getBoolFromSetupString(raw)
                      ? "✓"
                      : ""
                    : raw;
                return (
                  <div
                    key={f.key}
                    className="flex items-stretch min-h-[1.75rem]"
                  >
                    <div className="w-[40%] shrink-0 px-2 py-1 text-[10px] font-mono text-black/70 uppercase tracking-wide border-r border-black/15 flex items-center">
                      {f.label}
                      {f.unit ? (
                        <span className="normal-case ml-0.5 opacity-70 text-[9px]">
                          ({f.unit})
                        </span>
                      ) : null}
                    </div>
                    <div className="flex-1 min-w-0 flex items-center px-2 py-1 text-[11px] font-mono">
                      {val}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
