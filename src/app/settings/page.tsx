import { requireCurrentUser } from "@/lib/currentUser";
import {
  getLiveRcDriverIdSetting,
  getLiveRcDriverNameSetting,
  getMyNameSetting,
  getSpeedhiveDriverNameSetting,
  getSpeedhiveTransponderLoanerSetting,
  getSpeedhiveTransponderNumbersSetting,
} from "@/lib/appSettings";
import { SettingsClient } from "@/components/settings/SettingsClient";
import {
  formatSpeedhiveTransponderNumbersForSetting,
  parseSpeedhiveTransponderNumbersSetting,
} from "@/lib/speedhive/speedhiveTransponder";
import { SettingsNavSection } from "@/components/settings/SettingsNavSection";
import { ProfilePictureSection } from "@/components/settings/ProfilePictureSection";
import { AccountSection } from "@/components/settings/AccountSection";
import { OnboardingResetSection } from "@/components/settings/OnboardingResetSection";
import { NotificationsSection } from "@/components/settings/NotificationsSection";
import { AppearanceSection } from "@/components/settings/AppearanceSection";
import { AllowlistAdminSection } from "@/components/settings/AllowlistAdminSection";
import { ManufacturerBaselineAdminSection } from "@/components/settings/ManufacturerBaselineAdminSection";
import { isAuthAdminEmail } from "@/lib/authAdmin";
import { hasDatabaseUrl } from "@/lib/env";
import { cookies } from "next/headers";
import { RC_THEME_COOKIE, parseTheme } from "@/lib/theme/themeCookie";

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
  // Same cookie the root layout stamps <html> from — passed down so the client
  // component never has to guess, and server and client agree on first paint.
  const theme = parseTheme((await cookies()).get(RC_THEME_COOKIE)?.value);
  const [
    myName,
    liveRcDriverName,
    liveRcDriverId,
    speedhiveDriverName,
    speedhiveTransponderRaw,
    speedhiveTransponderLoaner,
  ] = await Promise.all([
    getMyNameSetting(user.id),
    getLiveRcDriverNameSetting(user.id),
    getLiveRcDriverIdSetting(user.id),
    getSpeedhiveDriverNameSetting(user.id),
    getSpeedhiveTransponderNumbersSetting(user.id),
    getSpeedhiveTransponderLoanerSetting(user.id),
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
        <div>
          <SettingsClient
            initial={{
            myName: myName ?? "",
            liveRcDriverName: liveRcDriverName ?? "",
            liveRcDriverId: liveRcDriverId ?? "",
            speedhiveDriverName: speedhiveDriverName ?? "",
            speedhiveTransponderNumbers: speedhiveTransponderNumbersText,
            speedhiveTransponderLoaner,
            }}
          />
        </div>
        <SettingsNavSection isAdmin={isAuthAdminEmail(user.email)} />
        <AppearanceSection initial={theme} />
        <NotificationsSection />
        <ProfilePictureSection
          initialImage={user.image}
          name={user.name}
          email={user.email}
        />
        <AccountSection email={user.email ?? ""} />
        {isAuthAdminEmail(user.email) ? (
          <>
            <OnboardingResetSection />
            <AllowlistAdminSection />
            <ManufacturerBaselineAdminSection />
          </>
        ) : null}
      </section>
    </>
  );
}
