import { requireCurrentUser } from "@/lib/currentUser";
import {
  getLiveRcDriverIdSetting,
  getLiveRcDriverNameSetting,
  getMyNameSetting,
  getSpeedhiveDriverNameSetting,
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
import { NotificationsSection } from "@/components/settings/NotificationsSection";
import { AllowlistAdminSection } from "@/components/settings/AllowlistAdminSection";
import { EngineerFeedbackAdminSection } from "@/components/settings/EngineerFeedbackAdminSection";
import { EngineerGoldSetAdminSection } from "@/components/settings/EngineerGoldSetAdminSection";
import { ManufacturerBaselineAdminSection } from "@/components/settings/ManufacturerBaselineAdminSection";
import { isAuthAdminEmail } from "@/lib/authAdmin";
import { hasDatabaseUrl } from "@/lib/env";

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
  const [myName, liveRcDriverName, liveRcDriverId, speedhiveDriverName, speedhiveTransponderRaw] =
    await Promise.all([
      getMyNameSetting(user.id),
      getLiveRcDriverNameSetting(user.id),
      getLiveRcDriverIdSetting(user.id),
      getSpeedhiveDriverNameSetting(user.id),
      getSpeedhiveTransponderNumbersSetting(user.id),
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
        <SettingsClient
          initial={{
            myName: myName ?? "",
            liveRcDriverName: liveRcDriverName ?? "",
            liveRcDriverId: liveRcDriverId ?? "",
            speedhiveDriverName: speedhiveDriverName ?? "",
            speedhiveTransponderNumbers: speedhiveTransponderNumbersText,
          }}
        />
        <SettingsNavSection />
        <NotificationsSection />
        <ProfilePictureSection
          initialImage={user.image}
          name={user.name}
          email={user.email}
        />
        <AccountSection email={user.email ?? ""} />
        {isAuthAdminEmail(user.email) ? (
          <>
            <AllowlistAdminSection />
            <ManufacturerBaselineAdminSection />
            <EngineerGoldSetAdminSection />
            <EngineerFeedbackAdminSection />
          </>
        ) : null}
      </section>
    </>
  );
}
