"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "@phosphor-icons/react";
import { CardPanel } from "@/components/ui/CardPanel";
import { Button } from "@/components/ui/Button";
import { Eyebrow } from "@/components/ui/panel";

/** Create a team and land straight in its feed. */
export function CreateTeamForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        team?: { id: string };
        error?: string;
      };
      if (!res.ok || !data.team) throw new Error(data.error || "Could not create team");
      router.push(`/teams/${data.team.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create team");
      setBusy(false);
    }
  }

  return (
    <CardPanel contentClassName="space-y-2.5">
      <Eyebrow>New team</Eyebrow>
      <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
        <div className="min-w-[200px] flex-1 space-y-1">
          <label htmlFor="team-name" className="ui-caption block">
            Name
          </label>
          <input
            id="team-name"
            className="min-h-9 w-full rounded-lg border border-border bg-secondary px-2.5 py-1.5 text-[13px] text-foreground placeholder:text-muted-foreground focus:border-primary-ink/40 focus:outline-none focus:ring-1 focus:ring-ring"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Southside club group"
          />
        </div>
        {/*
          A square + matched to the field's own height (`min-h-9`), not a labelled
          chip sitting short beside it. The label was carrying no information the
          form doesn't already give — the heading says "New team" and the only
          field is its name — so the word was costing width and breaking the line.
        */}
        <Button
          type="submit"
          disabled={busy || !name.trim()}
          aria-busy={busy}
          aria-label={busy ? "Creating team" : "Create team"}
          title="Create team"
          className="min-h-9 w-9 shrink-0 px-0 disabled:opacity-50"
        >
          <Plus size={16} weight="bold" aria-hidden />
        </Button>
      </form>
      {error ? <p className="text-[12px] text-destructive">{error}</p> : null}
    </CardPanel>
  );
}
