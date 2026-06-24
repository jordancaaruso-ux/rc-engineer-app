"use client";



import { useState } from "react";

import { cn } from "@/lib/utils";

import { buttonLinkClassName } from "@/components/ui/ButtonLink";

import { CardPanel } from "@/components/ui/CardPanel";

import type { AdditiveTypeOption } from "@/components/additives/AdditiveTypeCombobox";



export function AdditiveGaragePanel({

  initialAdditiveTypes,

}: {

  initialAdditiveTypes: AdditiveTypeOption[];

}) {

  const [additiveTypes, setAdditiveTypes] = useState(initialAdditiveTypes);

  const [newName, setNewName] = useState("");

  const [creating, setCreating] = useState(false);

  const [error, setError] = useState<string | null>(null);



  async function addAdditiveType(e: React.FormEvent) {

    e.preventDefault();

    const displayName = newName.trim();

    if (!displayName) return;

    setCreating(true);

    setError(null);

    try {

      const res = await fetch("/api/additive-types", {

        method: "POST",

        headers: { "Content-Type": "application/json" },

        body: JSON.stringify({ displayName }),

      });

      const data = (await res.json()) as {

        additiveType?: AdditiveTypeOption;

        existing?: AdditiveTypeOption;

        error?: string;

      };

      if (res.status === 409 && data.existing) {

        setAdditiveTypes((prev) => {

          if (prev.some((t) => t.id === data.existing!.id)) return prev;

          return [...prev, data.existing!].sort((a, b) => a.displayName.localeCompare(b.displayName));

        });

        setNewName("");

        return;

      }

      if (!res.ok || !data.additiveType) {

        setError(data.error ?? "Failed to add additive type");

        return;

      }

      setAdditiveTypes((prev) =>

        [...prev.filter((t) => t.id !== data.additiveType!.id), data.additiveType!].sort((a, b) =>

          a.displayName.localeCompare(b.displayName)

        )

      );

      setNewName("");

    } catch {

      setError("Failed to add additive type");

    } finally {

      setCreating(false);

    }

  }



  return (

    <div className="space-y-4">

      <form onSubmit={addAdditiveType} className="flex flex-wrap gap-2 items-start">

        <input

          className="flex-1 min-w-[12rem] rounded-md border border-border bg-card px-3 py-2 text-sm outline-none"

          placeholder="e.g. Mighty Gripper - Yellow"

          value={newName}

          onChange={(e) => setNewName(e.target.value)}

          aria-label="New additive type name"

        />

        <button

          type="submit"

          disabled={creating || !newName.trim()}

          className={cn(

            buttonLinkClassName("primary"),

            "text-sm px-4 py-2",

            (creating || !newName.trim()) && "opacity-60 pointer-events-none"

          )}

        >

          {creating ? "Adding…" : "Add"}

        </button>

      </form>



      {error ? <p className="text-sm text-destructive">{error}</p> : null}



      {additiveTypes.length === 0 ? (

        <p className="text-sm text-muted-foreground">No additive types yet.</p>

      ) : (

        <ul className="flex flex-col gap-2.5">

          {additiveTypes.map((t) => (

            <li key={t.id}>

              <CardPanel contentClassName="px-4 py-3">

                <span className="text-sm font-medium">{t.displayName}</span>

              </CardPanel>

            </li>

          ))}

        </ul>

      )}

    </div>

  );

}

