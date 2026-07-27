import Link from "next/link";
import { LEGAL_CONTACT_EMAIL, LEGAL_LAST_UPDATED, LEGAL_OPERATOR } from "@/lib/legal/legalMeta";

export const metadata = {
  title: "Privacy — JRC Race Engineer",
  description: "Privacy policy for JRC Race Engineer",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-base font-semibold">{title}</h2>
      <div className="mt-2 space-y-3 text-muted-foreground">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <div className="container mx-auto max-w-2xl px-4 py-10 text-sm leading-relaxed text-foreground">
      <h1 className="page-title">Privacy policy</h1>
      <p className="mt-4 text-muted-foreground">
        JRC Race Engineer is a run-logging and setup-analysis tool for RC racing, operated by{" "}
        {LEGAL_OPERATOR} in Australia. This policy explains what the hosted service collects, who it
        is shared with, and how to get your data back or deleted. Questions:{" "}
        <a className="underline underline-offset-4" href={`mailto:${LEGAL_CONTACT_EMAIL}`}>
          {LEGAL_CONTACT_EMAIL}
        </a>
        .
      </p>

      <Section title="Who we are">
        <p>
          {LEGAL_OPERATOR} is the data controller for this service. We handle personal information
          under the Australian Privacy Act 1988 (Australian Privacy Principles). If you are in the
          UK or EEA, we also process your data under the UK GDPR / EU GDPR — our lawful bases are
          performance of a contract (running the account you asked for) and legitimate interests
          (keeping the service secure and working).
        </p>
      </Section>

      <Section title="Account and authentication">
        <p>
          Sign-in uses an emailed magic link, or optionally Google. We store your email address to
          identify the account, plus a display name and avatar if you set one. Session cookies keep
          you signed in on devices you use. We do not store passwords.
        </p>
        <p>
          Access is currently gated by invitation or a shared access code. The email address you
          enter when redeeming a code is stored so the sign-in can complete.
        </p>
      </Section>

      <Section title="What you store here">
        <p>
          Content you create: runs and run notes, lap times, car and tire records, setup sheets you
          upload (PDF or photo) and the values extracted from them, race results, track and event
          records, videos you upload for analysis, and your app settings.
        </p>
        <p>
          Collected automatically: approximate weather conditions for a run (fetched by track
          location and time), timestamps, and standard server logs used to operate and secure the
          service.
        </p>
      </Section>

      <Section title="AI features">
        <p>
          When you use the Engineer (chat, suggestions, quick fixes) or automatic setup-sheet
          reading, the relevant parts of your data — run history, setup values, notes, lap times,
          and uploaded setup sheet images — are sent to our AI provider, OpenAI, to generate the
          response. We do not send your email address or account identifiers.
        </p>
        <p>
          Engineer output is generated guidance, not verified advice. See the{" "}
          <Link className="underline underline-offset-4" href="/terms">
            Terms
          </Link>
          .
        </p>
      </Section>

      <Section title="Community data">
        <p>
          Setup values from uploaded setup sheets contribute to aggregate community statistics —
          for example, typical settings for a chassis in given conditions. These aggregates are
          combined across users and are not labelled with your name, email, or account. Your
          individual runs, notes, videos and setup sheets are private to your account and are never
          shown to other users unless you join a team.
        </p>
        <p>
          Joining a team is always your choice: an invite has to be accepted by you before anything
          is shared, and nobody can add you to a team without that. Once you accept, other members of
          that team can see your runs, setups and lap data — including runs logged before you joined —
          and you can see theirs. Individual runs can be withheld with “Share this run with my teams”,
          and leaving a team ends the team’s access to your data.
        </p>
        <p>
          Records you add to shared catalogs — tracks, tire types, additive types, events — are
          visible to other users by design, because the catalog is shared infrastructure.
        </p>
      </Section>

      <Section title="Who we share it with">
        <p>We use these providers to run the service. We do not sell your data to anyone.</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Vercel — application hosting and file storage (uploads).</li>
          <li>Neon — managed PostgreSQL database.</li>
          <li>OpenAI — AI features, as described above.</li>
          <li>Our email provider — sending sign-in links and notifications.</li>
          <li>Google — only if you choose to sign in with Google.</li>
          <li>Apple / browser push services — only if you enable notifications.</li>
          <li>Open-Meteo — weather lookup by track location and time.</li>
        </ul>
        <p>
          When you import lap times, the app fetches publicly available timing pages (LiveRC, MyRCM,
          Speedhive) using the URL or driver name you provide. Those sites are not sent your account
          data.
        </p>
        <p>
          Some of these providers process data outside Australia, including in the United States. We
          may also disclose data if required by law.
        </p>
      </Section>

      <Section title="How long we keep it">
        <p>
          Your content is kept while your account exists. Server logs are kept for a short period
          for security and debugging. Aggregate community statistics are derived data and may
          persist after an account is deleted, because they cannot be traced back to an individual.
        </p>
      </Section>

      <Section title="Your choices and rights">
        <p>
          You can access and edit your data in the app at any time. You can delete your account from{" "}
          <span className="text-foreground">Settings → Account</span>, which permanently removes
          your account, your runs and records, and your uploaded files. This cannot be undone.
        </p>
        <p>
          You may also ask us for a copy of your data, ask us to correct it, or object to how we use
          it. Email{" "}
          <a className="underline underline-offset-4" href={`mailto:${LEGAL_CONTACT_EMAIL}`}>
            {LEGAL_CONTACT_EMAIL}
          </a>{" "}
          and we will respond within 30 days. If you are unhappy with our response you can complain
          to the Office of the Australian Information Commissioner (oaic.gov.au), or to your local
          data protection authority.
        </p>
      </Section>

      <Section title="Security">
        <p>
          Traffic is served over HTTPS, data is stored with managed providers, and access to your
          content requires being signed in to your account. No service can promise perfect
          security; please do not upload anything you would not want stored on a third-party cloud.
        </p>
      </Section>

      <Section title="Children">
        <p>
          This service is not directed at children under 13, and we do not knowingly collect their
          data. If a child has created an account, contact us and we will delete it.
        </p>
      </Section>

      <Section title="Changes">
        <p>
          We may update this policy as the service changes. Material changes will be surfaced in the
          app. The date below shows the current version.
        </p>
      </Section>

      <p className="mt-10 text-xs text-muted-foreground">
        Last updated {LEGAL_LAST_UPDATED}.{" "}
        <Link className="underline underline-offset-4" href="/terms">
          Terms of use
        </Link>
      </p>
    </div>
  );
}
