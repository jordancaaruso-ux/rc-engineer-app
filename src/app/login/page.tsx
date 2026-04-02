"use client";

import type { ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; gateDisabled?: boolean };
      if (!res.ok) {
        setError(data.error ?? "Login failed");
        return;
      }
      if (data.gateDisabled) {
        const from = searchParams.get("from") || "/";
        router.push(from.startsWith("/") ? from : "/");
        router.refresh();
        return;
      }
      const from = searchParams.get("from") || "/";
      router.push(from.startsWith("/") ? from : "/");
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <main style={{ padding: "2rem", maxWidth: 360, margin: "10vh auto", fontFamily: "system-ui" }}>
      <h1 style={{ fontSize: "1.25rem", marginBottom: "1rem" }}>RC Engineer — private access</h1>
      <form onSubmit={onSubmit}>
        <label style={{ display: "block", marginBottom: "0.5rem" }}>
          Password
          <input
            type="password"
            name="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            style={{ display: "block", width: "100%", marginTop: 4, padding: "0.5rem" }}
            required
          />
        </label>
        {error ? <p style={{ color: "crimson", fontSize: 14, marginBottom: 8 }}>{error}</p> : null}
        <button type="submit" disabled={pending} style={{ padding: "0.5rem 1rem" }}>
          {pending ? "…" : "Continue"}
        </button>
      </form>
    </main>
  );
}

export default function LoginPage(): ReactNode {
  return (
    <Suspense fallback={<main style={{ padding: "2rem" }}>Loading…</main>}>
      <LoginForm />
    </Suspense>
  );
}
