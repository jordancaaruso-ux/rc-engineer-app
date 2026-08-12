"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { isEndDateBeforeStartDateYmd } from "@/lib/eventDateValidation";
import { cn } from "@/lib/utils";
import { buttonLinkClassName } from "@/components/ui/ButtonLink";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { TireTypeCombobox } from "@/components/tires/TireTypeCombobox";
import { AdditiveTypeCombobox } from "@/components/additives/AdditiveTypeCombobox";

export type TrackOption = { id: string; name: string; location?: string | null };

/**
 * The create-an-event form, lifted out of `EventList` unchanged so the desktop page can
 * mount the same one behind its "New event" button.
 *
 * Extraction only — every field, validation rule and request body is as it was. The
 * desktop redesign deliberately did not redesign this form (open question 4 in the
 * handoff); duplicating it would have been the only other way to give desktop an add
 * path, and two copies of a nine-field form drift within a week.
 *
 * `suggestedStartYmd` is the one addition: the nothing-booked card reads a cadence out of
 * logged events ("five of the last six Saturdays") and can therefore open this form on the
 * date that cadence implies.
 */
export function EventAddForm({
  tracks,
  suggestedStartYmd,
  onCreated,
}: {
  tracks: TrackOption[];
  suggestedStartYmd?: string | null;
  onCreated?: (event: unknown) => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [trackId, setTrackId] = useState("");
  const [startDate, setStartDate] = useState(suggestedStartYmd ?? "");
  const [endDate, setEndDate] = useState("");
  const [notes, setNotes] = useState("");
  const [practiceSourceUrl, setPracticeSourceUrl] = useState("");
  const [resultsSourceUrl, setResultsSourceUrl] = useState("");
  const [tireControlled, setTireControlled] = useState(false);
  const [controlledTireTypeId, setControlledTireTypeId] = useState("");
  const [controlAdditiveEnabled, setControlAdditiveEnabled] = useState(false);
  const [controlledAdditiveTypeId, setControlledAdditiveTypeId] = useState("");
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // A suggested date arriving after mount (the card computes it) should fill an untouched
  // field, but must never overwrite a date the driver has already typed.
  useEffect(() => {
    if (suggestedStartYmd) setStartDate((prev) => prev || suggestedStartYmd);
  }, [suggestedStartYmd]);

  const dateRangeInvalid = useMemo(
    () => isEndDateBeforeStartDateYmd(startDate, endDate),
    [startDate, endDate]
  );

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setMessage("Name is required.");
      return;
    }
    if (!trackId.trim()) {
      setMessage("Select a track for this event.");
      return;
    }
    if (dateRangeInvalid) {
      setMessage(null);
      return;
    }
    setMessage(null);
    setAdding(true);
    try {
      const start = startDate || new Date().toISOString().slice(0, 10);
      const end = endDate || start;
      const res = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmed,
          trackId,
          startDate: start,
          endDate: end,
          notes: notes.trim() || null,
          practiceSourceUrl: practiceSourceUrl.trim() || null,
          resultsSourceUrl: resultsSourceUrl.trim() || null,
          controlledTireTypeId: tireControlled ? controlledTireTypeId.trim() || null : null,
          controlledAdditiveTypeId: controlAdditiveEnabled
            ? controlledAdditiveTypeId.trim() || null
            : null,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        event?: unknown;
        error?: string;
        existingEventId?: string;
      };
      if (res.status === 409 && data.event) {
        onCreated?.(data.event);
        setMessage(data.error ?? "Joined existing event with this LiveRC URL.");
        router.refresh();
        return;
      }
      if (!res.ok) {
        throw new Error(data.error ?? `Request failed (${res.status})`);
      }
      onCreated?.((data as { event: unknown }).event);
      setName("");
      setTrackId("");
      setStartDate("");
      setEndDate("");
      setNotes("");
      setPracticeSourceUrl("");
      setResultsSourceUrl("");
      setTireControlled(false);
      setControlledTireTypeId("");
      setControlAdditiveEnabled(false);
      setControlledAdditiveTypeId("");
      setMessage("Event created.");
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to create event");
    } finally {
      setAdding(false);
    }
  }

  return (
    <form onSubmit={handleAdd} className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label className="block text-[11px] text-muted-foreground mb-1">Name *</label>
          <input
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. BRCA Nationals R3"
            required
          />
        </div>
        <div>
          <label className="block text-[11px] text-muted-foreground mb-1">Track *</label>
          <select
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none"
            value={trackId}
            onChange={(e) => setTrackId(e.target.value)}
            aria-label="Track"
            required
          >
            <option value="">— Select track —</option>
            {tracks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.location ? ` (${t.location})` : ""}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label className="block text-[11px] text-muted-foreground mb-1">Start date</label>
          <input
            type="date"
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            aria-label="Start date"
          />
        </div>
        <div>
          <label className="block text-[11px] text-muted-foreground mb-1">End date</label>
          <input
            type="date"
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            aria-label="End date"
          />
        </div>
      </div>
      {dateRangeInvalid ? (
        <p className="text-[11px] text-destructive">
          End date must be on or after the start date.
        </p>
      ) : null}
      <div>
        <label className="block text-[11px] text-muted-foreground mb-1">Notes (optional)</label>
        <input
          className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Optional notes"
        />
      </div>
      <div>
        <label className="block text-[11px] text-muted-foreground mb-1">
          Practice timing URL (optional)
        </label>
        <input
          type="url"
          className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none"
          value={practiceSourceUrl}
          onChange={(e) => setPracticeSourceUrl(e.target.value)}
          placeholder="LiveRC practice session list URL"
        />
      </div>
      <div>
        <label className="block text-[11px] text-muted-foreground mb-1">
          Race timing URL (optional)
        </label>
        <input
          type="url"
          className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none"
          value={resultsSourceUrl}
          onChange={(e) => setResultsSourceUrl(e.target.value)}
          placeholder="LiveRC results / race timing page URL"
        />
      </div>
      <div className="space-y-1.5">
        <label className="block text-[11px] text-muted-foreground">Tire</label>
        <SegmentedControl<"open" | "controlled">
          ariaLabel="Event tire — open or controlled"
          size="sm"
          value={tireControlled ? "controlled" : "open"}
          onChange={(v) => {
            const on = v === "controlled";
            setTireControlled(on);
            if (!on) setControlledTireTypeId("");
          }}
          options={[
            { value: "open", label: "Open" },
            { value: "controlled", label: "Controlled" },
          ]}
        />
        {tireControlled ? (
          <TireTypeCombobox
            value={controlledTireTypeId}
            onChange={setControlledTireTypeId}
            placeholder="Select control tire type…"
            aria-label="Event control tire type"
          />
        ) : null}
      </div>
      <div className="space-y-1.5">
        <label className="block text-[11px] text-muted-foreground">Additive</label>
        <SegmentedControl<"open" | "controlled">
          ariaLabel="Event additive — open or controlled"
          size="sm"
          value={controlAdditiveEnabled ? "controlled" : "open"}
          onChange={(v) => {
            const on = v === "controlled";
            setControlAdditiveEnabled(on);
            if (!on) setControlledAdditiveTypeId("");
          }}
          options={[
            { value: "open", label: "Open" },
            { value: "controlled", label: "Controlled" },
          ]}
        />
        {controlAdditiveEnabled ? (
          <AdditiveTypeCombobox
            value={controlledAdditiveTypeId}
            onChange={setControlledAdditiveTypeId}
            placeholder="Select control additive…"
            aria-label="Event control additive type"
            allowInlineCreate={false}
          />
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={adding || !trackId.trim() || dateRangeInvalid}
          className={cn(
            buttonLinkClassName("primary"),
            (adding || !trackId.trim() || dateRangeInvalid) && "opacity-70 pointer-events-none"
          )}
        >
          {adding ? "Creating…" : "Create event"}
        </button>
        {message && (
          <span
            className={cn(
              "text-xs",
              message === "Event created." ? "text-primary-ink" : "text-muted-foreground"
            )}
          >
            {message}
          </span>
        )}
      </div>
    </form>
  );
}
