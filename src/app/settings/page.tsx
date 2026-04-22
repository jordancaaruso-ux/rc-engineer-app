import { requireCurrentUser } from "@/lib/currentUser";
import {
  getCurrentPracticeDayUrlSetting,
  getLiveRcDriverNameSetting,
  getMyNameSetting,
} from "@/lib/appSettings";
import { SettingsClient } from "@/components/settings/SettingsClient";
import { AccountSection } from "@/components/settings/AccountSection";
import { AllowlistAdminSection } from "@/components/settings/AllowlistAdminSection";
import { ManufacturerBaselineAdminSection } from "@/components/settings/ManufacturerBaselineAdminSection";
import { isAuthAdminEmail } from "@/lib/authAdmin";
import { hasDatabaseUrl } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  if (!hasDatabaseUrl()) {
    return (
      <div className="container mx-auto max-w-2xl py-8">
        <h1 className="text-lg font-semibold">Settings</h1>
        <p className="mt-2 text-sm text-destructive">DATABASE_URL is not set.</p>
      </div>
    );
  }
  const user = await requireCurrentUser();
  const [myName, liveRcDriverName, currentPracticeDayUrl] = await Promise.all([
    getMyNameSetting(user.id),
    getLiveRcDriverNameSetting(user.id),
    getCurrentPracticeDayUrlSetting(user.id),
  ]);

  return (
    <div className="container mx-auto max-w-2xl py-8">
      <h1 className="text-lg font-semibold">Settings</h1>
      <p className="mt-1 text-xs text-muted-foreground">
        Per-user preferences. These persist across Log Your Run forms and lap imports.
      </p>
      <div className="mt-6">
        <SettingsClient
          initial={{
            myName: myName ?? "",
            liveRcDriverName: liveRcDriverName ?? "",
            currentPracticeDayUrl: currentPracticeDayUrl ?? "",
          }}
        />
        <AccountSection email={user.email ?? ""} />
        {isAuthAdminEmail(user.email) ? (
          <>
            <AllowlistAdminSection />
            <ManufacturerBaselineAdminSection />
          </>
        ) : null}
      </div>
    </div>
  );
}
