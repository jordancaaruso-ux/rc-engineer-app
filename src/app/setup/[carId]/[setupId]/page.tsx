import { redirect } from "next/navigation";

/** Setup detail now lives under the car — see `src/app/setup/[carId]/page.tsx` for why. */
export default async function LegacySetupViewPage(props: {
  params: Promise<{ carId: string; setupId: string }>;
}): Promise<never> {
  const { carId, setupId } = await props.params;
  redirect(`/cars/${carId}/setups/${setupId}`);
}
