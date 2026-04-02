"use client";

import type { SetupFieldKind, StructuredRow } from "@/lib/a800rrSetupDisplayConfig";
import { A800RR_STRUCTURED_SECTIONS } from "@/lib/a800rrSetupDisplayConfig";
import { normalizeSetupData, type SetupSnapshotData } from "@/lib/runSetup";
import { formatBoolDisplay, formatMultiDisplay, readSetupField, readSetupScrewSelection } from "@/lib/a800rrSetupRead";
import { companionOtherTextKeyForSingleSelect } from "@/lib/setupCalibrations/calibrationFieldCatalog";
import { AwesomatixScrewStrip } from "@/components/setup-sheet/AwesomatixScrewStrip";
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

function printCell(data: SetupSnapshotData, key: string, fieldKind?: SetupFieldKind): string {
  if (fieldKind === "bool") {
    const raw = readSetupField(data, key);
    if (raw === "") return "—";
    return formatBoolDisplay(raw);
  }
  if (fieldKind === "multi") {
    const raw = readSetupField(data, key);
    if (raw === "") return "—";
    return formatMultiDisplay(raw);
  }
  const co = companionOtherTextKeyForSingleSelect(key);
  if (co) {
    const ot = readSetupField(data, co);
    if (ot.trim()) return ot.trim();
  }
  const raw = readSetupField(data, key);
  if (raw === "") return "—";
  return raw;
}

function MetadataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex border-b border-black/20 last:border-b-0">
      <div className="w-24 shrink-0 py-0.5 pr-2 text-[10px] text-black/70 uppercase">{label}</div>
      <div className="min-w-0 flex-1 py-0.5 text-[11px] font-mono">{value}</div>
    </div>
  );
}

function PrintFieldRow({
  label,
  unit,
  value,
}: {
  label: string;
  unit?: string;
  value: string;
}) {
  return (
    <div className="flex min-h-[1.75rem] items-stretch border-b border-black/15 last:border-b-0">
      <div className="flex w-[40%] shrink-0 items-center border-r border-black/15 px-2 py-1 text-[10px] font-mono uppercase tracking-wide text-black/70">
        {label}
        {unit ? (
          <span className="normal-case ml-0.5 text-[9px] opacity-70">({unit})</span>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-1 items-center px-2 py-1 text-[11px] font-mono">{value}</div>
    </div>
  );
}

function PrintPairRow({
  label,
  unit,
  leftKey,
  rightKey,
  data,
  fieldKind,
}: {
  label: string;
  unit?: string;
  leftKey: string;
  rightKey: string;
  data: SetupSnapshotData;
  fieldKind?: SetupFieldKind;
}) {
  const left = printCell(data, leftKey, fieldKind);
  const right = printCell(data, rightKey, fieldKind);
  return (
    <div className="flex min-h-[1.75rem] items-stretch border-b border-black/15 last:border-b-0">
      <div className="flex w-[40%] shrink-0 items-center border-r border-black/15 px-2 py-1 text-[10px] font-mono uppercase tracking-wide text-black/70">
        {label}
        {unit ? (
          <span className="normal-case ml-0.5 text-[9px] opacity-70">({unit})</span>
        ) : null}
      </div>
      <div className="grid min-w-0 flex-1 grid-cols-2 divide-x divide-black/15">
        <div className="px-2 py-1">
          <div className="text-[9px] font-medium uppercase text-black/60">Front</div>
          <div className="text-[11px] font-mono">{left}</div>
        </div>
        <div className="px-2 py-1">
          <div className="text-[9px] font-medium uppercase text-black/60">Rear</div>
          <div className="text-[11px] font-mono">{right}</div>
        </div>
      </div>
    </div>
  );
}

function PrintCornerRow({
  label,
  unit,
  ff,
  fr,
  rf,
  rr,
  data,
  fieldKind,
}: {
  label: string;
  unit?: string;
  ff: string;
  fr: string;
  rf: string;
  rr: string;
  data: SetupSnapshotData;
  fieldKind?: SetupFieldKind;
}) {
  const cells = [
    { k: ff, lab: "FF" },
    { k: fr, lab: "FR" },
    { k: rf, lab: "RF" },
    { k: rr, lab: "RR" },
  ];
  return (
    <div className="border-b border-black/15 last:border-b-0">
      <div className="border-b border-black/15 px-2 py-1 text-[10px] font-mono uppercase tracking-wide text-black/70">
        {label}
        {unit ? (
          <span className="normal-case ml-0.5 text-[9px] opacity-70">({unit})</span>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-px bg-black/15">
        {cells.map(({ k, lab }) => (
          <div key={k} className="bg-white p-1.5">
            <div className="text-[9px] font-medium text-black/60">{lab}</div>
            <div className="text-[11px] font-mono">{printCell(data, k, fieldKind)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PrintTopDeckBlock({ data }: { data: SetupSnapshotData }) {
  const cutsSel = readSetupScrewSelection(data, "top_deck_cuts");
  return (
    <div className="divide-y divide-black/15">
      <PrintPairRow label="Top deck" leftKey="top_deck_front" rightKey="top_deck_rear" data={data} />
      <div className="flex min-h-[2rem] items-stretch border-b border-black/15 last:border-b-0">
        <div className="flex w-[40%] shrink-0 items-center border-r border-black/15 px-2 py-1 text-[10px] font-mono uppercase tracking-wide text-black/70">
          Top deck cuts
        </div>
        <div className="min-w-0 flex-1 px-2 py-1.5">
          <AwesomatixScrewStrip
            variant="top_deck_cuts"
            selected={cutsSel}
            readOnly
            className="[&_button]:border-black/30 [&_button]:bg-white [&_button]:text-black [&_button]:shadow-none"
          />
        </div>
      </div>
      <PrintFieldRow label="Top deck · Single" value={printCell(data, "top_deck_single")} />
    </div>
  );
}

function StructuredRowView({ row, data }: { row: StructuredRow; data: SetupSnapshotData }) {
  if (row.type === "single") {
    return (
      <PrintFieldRow
        label={row.label}
        unit={row.unit}
        value={printCell(data, row.key, row.fieldKind)}
      />
    );
  }
  if (row.type === "pair") {
    return (
      <PrintPairRow
        label={row.label}
        unit={row.unit}
        leftKey={row.leftKey}
        rightKey={row.rightKey}
        data={data}
        fieldKind={row.fieldKind}
      />
    );
  }
  if (row.type === "corner4") {
    return (
      <PrintCornerRow
        label={row.label}
        unit={row.unit}
        ff={row.ff}
        fr={row.fr}
        rf={row.rf}
        rr={row.rr}
        data={data}
        fieldKind={row.fieldKind}
      />
    );
  }
  if (row.type === "top_deck_block") {
    return <PrintTopDeckBlock data={data} />;
  }
  if (row.type === "screw_strip") {
    const variant =
      row.key === "motor_mount_screws"
        ? "motor_mount"
        : row.key === "top_deck_cuts"
          ? "top_deck_cuts"
          : "top_deck";
    const sel = readSetupScrewSelection(data, row.key);
    return (
      <div className="flex min-h-[2rem] items-stretch border-b border-black/15 last:border-b-0">
        <div className="flex w-[40%] shrink-0 items-center border-r border-black/15 px-2 py-1 text-[10px] font-mono uppercase tracking-wide text-black/70">
          {row.label}
        </div>
        <div className="min-w-0 flex-1 px-2 py-1.5">
          <AwesomatixScrewStrip
            variant={variant}
            selected={sel}
            readOnly
            className="[&_button]:border-black/30 [&_button]:bg-white [&_button]:text-black [&_button]:shadow-none"
          />
        </div>
      </div>
    );
  }
  return null;
}

export function A800RRSetupSheet({ run, className }: { run: A800RRSetupSheetRun; className?: string }) {
  const setupData: SetupSnapshotData = normalizeSetupData(run.setupSnapshot?.data ?? {});

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
      <div className="mb-3 rounded-sm border border-black/30 bg-white p-2">
        <div className="mb-1.5 text-[9px] font-medium uppercase tracking-wider text-black/60">
          Event / track / date
        </div>
        <div className="grid grid-cols-1 gap-x-4 text-[11px] sm:grid-cols-2">
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

      <div className="mb-3 border-b-2 border-black/30 pb-1.5 text-center">
        <div className="font-mono text-[10px] uppercase tracking-widest text-black/70">Setup sheet</div>
        <div className="text-sm font-medium">Awesomatix A800RR</div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {A800RR_STRUCTURED_SECTIONS.map((section) => (
          <div
            key={section.id}
            className="overflow-hidden rounded border-2 border-black/25 bg-white"
          >
            <div className="border-b border-black/20 bg-black/5 px-2 py-1.5 text-center text-[10px] font-medium uppercase tracking-wide">
              {section.title}
            </div>
            <div className="divide-y divide-black/10">
              {section.rows.map((row, idx) => (
                <div key={`${section.id}-${idx}`}>
                  <StructuredRowView row={row} data={setupData} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
