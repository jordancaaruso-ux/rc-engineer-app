import Link from "next/link";
import { isA800RRCar } from "@/lib/setupSheetTemplateId";

type Props = {
  carId: string;
  model: { id: string; name: string; slug: string };
  calibrationId: string | null;
  exampleDocumentId: string | null;
};

export function CarSetupSheetModelCard({ carId, model, calibrationId, exampleDocumentId }: Props) {
  return (
    <div className="rounded-lg border border-border bg-muted/50 p-4 text-sm space-y-3">
      <div>
        <div className="text-sm font-medium text-muted-foreground">Setup sheet model</div>
        <p className="mt-1 text-base font-medium text-foreground">{model.name}</p>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          Shared by all cars of this type. Parameters, PDF calibration, and in-app setup layout come from this
          model.
        </p>
      </div>
      <ul className="flex flex-col gap-2 text-xs">
        <li>
          <Link
            href={`/setup-sheet-models/${model.id}/schema`}
            className="text-sky-400 hover:text-sky-300 hover:underline"
          >
            Edit parameters
          </Link>
        </li>
        {calibrationId ? (
          <li>
            <Link
              href={`/setup-calibrations/${calibrationId}`}
              className="text-sky-400 hover:text-sky-300 hover:underline"
            >
              Edit PDF calibration (map fields)
            </Link>
          </li>
        ) : (
          <li className="text-muted-foreground">No calibration yet — upload a baseline PDF in the car wizard.</li>
        )}
        {exampleDocumentId ? (
          <li>
            <Link
              href={`/setup-documents/${exampleDocumentId}`}
              className="text-sky-400 hover:text-sky-300 hover:underline"
            >
              View baseline setup PDF
            </Link>
          </li>
        ) : null}
        <li>
          <Link
            href={`/setup?carId=${encodeURIComponent(carId)}`}
            className="text-sky-400 hover:text-sky-300 hover:underline"
          >
            Upload new setup for this car
          </Link>
        </li>
      </ul>
    </div>
  );
}

/** Show legacy A800 template editor only when car has no custom model. */
export function showLegacySetupSheetTemplateEdit(
  setupSheetModelId: string | null | undefined,
  setupSheetTemplate: string | null | undefined
): boolean {
  if (setupSheetModelId) return false;
  return isA800RRCar(setupSheetTemplate) || !setupSheetTemplate;
}
