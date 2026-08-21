import { requireCurrentUser } from "@/lib/currentUser";
import {
  getLiveRcDriverIdSetting,
  getLiveRcDriverNameSetting,
  getMyNameSetting,
  getSpeedhiveDriverNameSetting,
  getMyRcmDriverNameSetting,
  getSpeedhiveTransponderNumbersSetting,
} from "@/lib/appSettings";
import {
  formatSpeedhiveTransponderNumbersForSetting,
  parseSpeedhiveTransponderNumbersSetting,
} from "@/lib/speedhive/speedhiveTransponder";
import { YouSection } from "@/components/settings/YouSection";
import { TimingIdentitySection } from "@/components/settings/TimingIdentitySection";
import { SettingsNavSection } from "@/components/settings/SettingsNavSection";
import { DeleteAccountRow } from "@/components/settings/DeleteAccountRow";
import { OnboardingResetSection } from "@/components/settings/OnboardingResetSection";
import { AllowlistAdminSection } from "@/components/settings/AllowlistAdminSection";
import { EngineerFeedbackAdminSection } from "@/components/settings/EngineerFeedbackAdminSection";
import { EngineerLabSection } from "@/components/settings/EngineerLabSection";
import { ManufacturerBaselineAdminSection } from "@/components/settings/ManufacturerBaselineAdminSection";
import { isAuthAdminEmail } from "@/lib/authAdmin";
import { hasDatabaseUrl } from "@/lib/env";

/**
 * Settings, in four sections (resection 2026-08-18).
 *
 * The page had grown one field at a time: six controls ran naked down the top with nothing
 * naming the group, so every one of them explained itself in a hint — 227 words of grey text
 * before any admin block opened. The order below is the meaning. What's yours, then what lets
 * the app find your runs, then everything you're only visiting; admin folds away underneath,
 * and the one irreversible action sits alone at the bottom.
 *
 * Two things came off the page in the same pass, both founder calls:
 *   · Notifications — nothing is wired to send one (the cron was dropped in f1991af and has
 *     never fired in production), so the section was offering a switch attached to nothing.
 *     `NotificationsSection` is unmounted, not deleted: re-add the one line when push is real.
 *   · The loaner / club-chip declaration — see `TimingIdentitySection`.
 *
 * Headings moved INTO their cards on 2026-08-18 (founder call). This page was the only
 * place in the app holding section labels out in the page ground — the other 180-odd uses
 * of `Eyebrow` sit inside the card they name. Off-card looked good here and nowhere else:
 * a floating label needs a bigger gap above than below or it reads as a caption on the card
 * above it, and any card whose top row pairs a label with a counter or a button (the
 * dashboard's Today card) falls apart without it. One rule now — the card names itself, so
 * it survives being dropped anywhere: a drawer, a share image, an empty state on its own.
 * Section spacing came down from `space-y-8` to `space-y-4` to match: the gap no longer has
 * to hold a label to the right card.
 */

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  if (!hasDatabaseUrl()) {
    return (
      <div className="container mx-auto max-w-2xl py-8">
        <h1 className="page-title">Settings</h1>
        <p className="mt-2 text-sm text-destructive">DATABASE_URL is not set.</p>
      </div>
    );
  }
  const user = await requireCurrentUser();
  const isAdmin = isAuthAdminEmail(user.email);
  const [
    myName,
    liveRcDriverName,
    liveRcDriverId,
    speedhiveDriverName,
    speedhiveTransponderRaw,
    myRcmDriverName,
  ] = await Promise.all([
    getMyNameSetting(user.id),
    getLiveRcDriverNameSetting(user.id),
    getLiveRcDriverIdSetting(user.id),
    getSpeedhiveDriverNameSetting(user.id),
    getSpeedhiveTransponderNumbersSetting(user.id),
    getMyRcmDriverNameSetting(user.id),
  ]);
  const speedhiveTransponderNumbersText = formatSpeedhiveTransponderNumbersForSetting(
    parseSpeedhiveTransponderNumbersSetting(speedhiveTransponderRaw)
  );

  return (
    <>
      <header className="page-header">
        <div className="min-w-0">
          <h1 className="page-title">Settings</h1>
        </div>
      </header>
      <section className="page-body max-w-2xl">
        <div className="space-y-4">
          <YouSection
            initialImage={user.image}
            initialName={myName ?? ""}
            name={user.name}
            email={user.email}
          />

          <TimingIdentitySection
            initial={{
              liveRcDriverName: liveRcDriverName ?? "",
              liveRcDriverId: liveRcDriverId ?? "",
              speedhiveDriverName: speedhiveDriverName ?? "",
              speedhiveTransponderNumbers: speedhiveTransponderNumbersText,
              myRcmDriverName: myRcmDriverName ?? "",
            }}
          />

          <SettingsNavSection isAdmin={isAdmin} />

          {isAdmin ? (
            <details className="group">
              <summary className="ui-title flex cursor-pointer list-none items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground">
                <span className="transition-transform group-open:rotate-90" aria-hidden>
                  ›
                </span>
                Admin
              </summary>
              <div className="mt-2">
                <EngineerLabSection />
                <OnboardingResetSection />
                <AllowlistAdminSection />
                <ManufacturerBaselineAdminSection />
                {/* Gold-set admin section unplugged 2026-07-30 (founder call) — founder reviews
                    via in-app ratings + notes; component kept for easy revival. */}
                <EngineerFeedbackAdminSection />
              </div>
            </details>
          ) : null}
        </div>

        <DeleteAccountRow />
      </section>
    </>
  );
}
