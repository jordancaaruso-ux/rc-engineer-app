"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function SetupDocumentError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[setup-document]", error);
  }, [error]);

  return (
    <section className="page-body max-w-lg">
      <h1 className="ui-title text-lg text-destructive">Could not load this setup document</h1>
      <p className="text-sm text-muted-foreground">
        Something went wrong in the browser while rendering the review page. Try again, or open Setup and pick the
        document from the list.
      </p>
      {error.message ? (
        <pre className="rounded border border-border/70 bg-muted/40 p-3 text-[11px] text-muted-foreground whitespace-pre-wrap break-words">
          {error.message}
        </pre>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-md border border-border bg-card px-3 py-2 text-xs hover:bg-muted"
          onClick={() => reset()}
        >
          Try again
        </button>
        <Link href="/setup" className="rounded-md border border-border bg-card px-3 py-2 text-xs hover:bg-muted">
          Back to Setup
        </Link>
      </div>
    </section>
  );
}
