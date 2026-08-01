import Link from "next/link";
import { isA800RRCar } from "@/lib/setupSheetTemplateId";
import { CardPanel } from "@/components/ui/CardPanel";

type Props = {
  carId: string;
  model: { id: string; name: string; slug: string };
  /** Calibration mapping + baseline-PDF doors are admin tooling; the schema link also serves
   *  the creator of a still-unauthorized model (hand-build path) — the CALLER gates on
   *  `canEditSetupSheetModel` and this card only renders for those two audiences. */
  isAdmin: boolean;
  calibrationId: string | null;
  calibrationName: string | null;
  exampleDocumentId: string | null;
};

export function CarSetupSheetModelCard({
  carId,
  model,
  isAdmin,
  calibrationId,
  calibrationName,
  exampleDocumentId,
}: Props) {
  return (
    <CardPanel contentClassName="text-sm space-y-3">
      <div>
        <div className="text-sm font-medium text-muted-foreground">Setup sheet model</div>
        <p className="mt-1 text-base font-medium text-foreground">{model.name}</p>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          Shared by all cars of this type (e.g. all Mugen MTC3 cars). Parameters, PDF calibration, and in-app
          layout come from this model. Uploads match calibrations by PDF form layout, not by car name.
        </p>
        {calibrationName ? (
          <p className="text-[11px] text-foreground/90 mt-1">
            Default PDF calibration: <span className="font-medium">{calibrationName}</span>
          </p>
        ) : (
          <p className="text-[11px] text-amber-200/90 mt-1">No default PDF calibration yet.</p>
        )}
      </div>
      <ul className="flex flex-col gap-2 text-xs">
        <li>
          <Link
            href={`/setup-sheet-models/${model.id}/schema`}
            className="text-accent hover:text-accent hover:underline"
          >
            Edit setup sheet
          </Link>
        </li>
        {isAdmin ? (
          calibrationId ? (
            <li>
              <Link
                href={`/setup-calibrations/${calibrationId}`}
                className="text-accent hover:text-accent hover:underline"
              >
                Edit PDF calibration (map fields)
              </Link>
            </li>
          ) : (
            <li className="text-muted-foreground">No calibration yet — upload a baseline PDF in the car wizard.</li>
          )
        ) : null}
        {isAdmin && exampleDocumentId ? (
          <li>
            <Link
              href={`/setup-documents/${exampleDocumentId}`}
              className="text-accent hover:text-accent hover:underline"
            >
              View baseline setup PDF
            </Link>
          </li>
        ) : null}
        <li>
          <Link
            href={`/cars?carId=${encodeURIComponent(carId)}`}
            className="text-accent hover:text-accent hover:underline"
          >
            Upload new setup for this car
          </Link>
        </li>
      </ul>
    </CardPanel>
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
