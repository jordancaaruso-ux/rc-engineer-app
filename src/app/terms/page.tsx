import Link from "next/link";
import { LEGAL_CONTACT_EMAIL, LEGAL_LAST_UPDATED, LEGAL_OPERATOR } from "@/lib/legal/legalMeta";
import { PRODUCT_NAME } from "@/lib/brand/brandNames";

export const metadata = {
  title: `Terms — ${PRODUCT_NAME}`,
  description: `Terms of use for ${PRODUCT_NAME}`,
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-base font-semibold">{title}</h2>
      <div className="mt-2 space-y-3 text-muted-foreground">{children}</div>
    </section>
  );
}

export default function TermsPage() {
  return (
    <div className="container mx-auto max-w-2xl px-4 py-10 text-sm leading-relaxed text-foreground">
      <h1 className="page-title">Terms of use</h1>
      <p className="mt-4 text-muted-foreground">
        These terms cover your use of {PRODUCT_NAME}, operated by {LEGAL_OPERATOR}. By signing in
        you agree to them. If you do not agree, do not use the service.
      </p>

      <Section title="Early access">
        <p>
          This is early-access software under active development. Features may change, move, or be
          removed, and the service may be unavailable at times. It is provided free of charge for
          now; paid plans may be introduced later, and we will tell you before anything you rely on
          starts costing money.
        </p>
      </Section>

      <Section title="Your account">
        <p>
          Access is by invitation or a shared access code. Keep your access code and your email
          inbox secure — anyone with access to your inbox can sign in as you. You are responsible
          for activity on your account. Do not share an account with someone else; ask for a code
          for them instead.
        </p>
        <p>
          You must be at least 13 years old to use the service, and old enough to agree to these
          terms where you live.
        </p>
      </Section>

      <Section title="Engineer output is guidance, not advice">
        <p>
          The Engineer, setup suggestions, calculators, and any other analysis in this app are
          automatically generated from your data and general vehicle-dynamics reference material.
          They can be wrong, incomplete, or inappropriate for your car, track, or conditions.
        </p>
        <p>
          You are responsible for every change you make to a vehicle and for running it safely.
          Always check that a setup change is mechanically sound and within your class rules before
          driving. Do not rely on this app for anything safety-critical.
        </p>
      </Section>

      <Section title="Your content">
        <p>
          Your runs, notes, setup sheets, videos and other uploads remain yours. You give us only
          the permission needed to host and process them so the app can work for you — storing
          them, showing them back to you, and sending relevant parts to our AI provider when you use
          an AI feature.
        </p>
        <p>
          Only upload content you have the right to upload. Do not upload another person&apos;s
          private data, or media you do not have permission to use.
        </p>
      </Section>

      <Section title="Community data">
        <p>
          Setup values from uploaded setup sheets feed aggregate community statistics — typical
          settings for a chassis in given conditions, and similar. These aggregates combine many
          users and are not labelled with your identity. By uploading setup sheets you agree to this
          use. Records you create in shared catalogs (tracks, tire types, additive types, events)
          are visible to other users and may be edited, merged, or removed to keep the catalog
          clean.
        </p>
        <p>
          Your individual runs, notes, videos and setup sheets stay private to your account, as
          described in the{" "}
          <Link className="underline underline-offset-4" href="/privacy">
            Privacy policy
          </Link>
          .
        </p>
      </Section>

      <Section title="Acceptable use">
        <p>Do not:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>try to access another user&apos;s account or data;</li>
          <li>
            script, scrape, or automate the app in a way that generates unreasonable load, or work
            around usage limits;
          </li>
          <li>upload malware, or content that is unlawful, abusive, or infringing;</li>
          <li>resell or redistribute the service or its AI output as your own product.</li>
        </ul>
        <p>
          AI features have usage limits so one account cannot exhaust shared capacity. We may adjust
          those limits without notice.
        </p>
      </Section>

      <Section title="Third-party sites">
        <p>
          Lap import reads publicly available timing pages (LiveRC, Speedhive) from URLs you
          provide. We are not affiliated with those services, do not control their data, and cannot
          guarantee an import is accurate or will keep working.
        </p>
      </Section>

      <Section title="Ending your use">
        <p>
          You can delete your account at any time from Settings → Account, which permanently removes
          your data and uploaded files. We may suspend or close an account that breaks these terms,
          or if we stop operating the service — we will give reasonable notice and a chance to
          export your data where we can.
        </p>
      </Section>

      <Section title="No warranty and liability">
        <p>
          The service is provided &quot;as is&quot;, without warranties of any kind. We do not
          promise it will be uninterrupted, error-free, or that any analysis will be accurate. Keep
          your own copies of anything important — we are not a backup service.
        </p>
        <p>
          To the maximum extent permitted by law, we are not liable for indirect or consequential
          loss, lost data, lost race results, or damage to vehicles or equipment arising from your
          use of the service. Nothing in these terms excludes rights you have under the Australian
          Consumer Law or other laws that cannot be excluded; where liability cannot be excluded, it
          is limited to resupplying the service.
        </p>
      </Section>

      <Section title="Changes and contact">
        <p>
          We may update these terms as the service changes; material changes will be surfaced in the
          app. These terms are governed by the laws of New South Wales, Australia. Questions:{" "}
          <a className="underline underline-offset-4" href={`mailto:${LEGAL_CONTACT_EMAIL}`}>
            {LEGAL_CONTACT_EMAIL}
          </a>
          .
        </p>
      </Section>

      <p className="mt-10 text-xs text-muted-foreground">
        Last updated {LEGAL_LAST_UPDATED}.{" "}
        <Link className="underline underline-offset-4" href="/privacy">
          Privacy policy
        </Link>
      </p>
    </div>
  );
}
