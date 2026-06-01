import { requireCurrentUser } from "@/lib/currentUser";
import {
  getLiveRcDriverIdSetting,
  getLiveRcDriverNameSetting,
  getMyNameSetting,
} from "@/lib/appSettings";
import { SettingsClient } from "@/components/settings/SettingsClient";
import { SettingsNavSection } from "@/components/settings/SettingsNavSection";
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
        <h1 className="page-title text-base">Settings</h1>
        <p className="mt-2 text-sm text-destructive">DATABASE_URL is not set.</p>
      </div>
    );
  }
  const user = await requireCurrentUser();
  const [myName, liveRcDriverName, liveRcDriverId] = await Promise.all([
    getMyNameSetting(user.id),
    getLiveRcDriverNameSetting(user.id),
    getLiveRcDriverIdSetting(user.id),
  ]);

  return (
    <>
      <header className="page-header">
        <div className="min-w-0">
          <h1 className="page-title text-base">Settings</h1>
          <p className="page-subtitle mt-0.5">
            Per-user preferences. These persist across Log Your Run forms and lap imports.
          </p>
        </div>
      </header>
      <section className="page-body max-w-2xl">
        <SettingsClient
          initial={{
            myName: myName ?? "",
            liveRcDriverName: liveRcDriverName ?? "",
            liveRcDriverId: liveRcDriverId ?? "",
          }}
        />
        <SettingsNavSection />
        <AccountSection email={user.email ?? ""} />
        {isAuthAdminEmail(user.email) ? (
          <>
            <AllowlistAdminSection />
            <ManufacturerBaselineAdminSection />
          </>
        ) : null}
      </section>
    </>
  );
}
