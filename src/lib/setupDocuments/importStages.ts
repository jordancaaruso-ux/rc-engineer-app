export const SetupDocumentImportStages = {
  UPLOAD_RECEIVED: "upload_received",
  FILE_PERSISTED: "file_persisted",
  AWAITING_CALIBRATION: "awaiting_calibration",
  PDF_LOADED: "pdf_loaded",
  RAW_FORM_FIELDS_EXTRACTED: "raw_form_fields_extracted",
  CALIBRATION_SELECTED: "calibration_selected",
  NORMALIZATION_STARTED: "normalization_started",
  NORMALIZATION_COMPLETED: "normalization_completed",
  FIELD_MAPPING_STARTED: "field_mapping_started",
  FIELD_MAPPING_COMPLETED: "field_mapping_completed",
  DERIVED_FIELDS_STARTED: "derived_fields_started",
  DERIVED_FIELDS_COMPLETED: "derived_fields_completed",
  DATABASE_SAVE_STARTED: "database_save_started",
  DATABASE_SAVE_COMPLETED: "database_save_completed",
  PARSE_FINISHED_SUCCESSFULLY: "parse_finished_successfully",
} as const;

export type SetupDocumentImportStage =
  (typeof SetupDocumentImportStages)[keyof typeof SetupDocumentImportStages];

export const SETUP_DOCUMENT_IMPORT_STAGE_ORDER: SetupDocumentImportStage[] = [
  SetupDocumentImportStages.UPLOAD_RECEIVED,
  SetupDocumentImportStages.FILE_PERSISTED,
  SetupDocumentImportStages.AWAITING_CALIBRATION,
  SetupDocumentImportStages.PDF_LOADED,
  SetupDocumentImportStages.RAW_FORM_FIELDS_EXTRACTED,
  SetupDocumentImportStages.CALIBRATION_SELECTED,
  SetupDocumentImportStages.NORMALIZATION_STARTED,
  SetupDocumentImportStages.NORMALIZATION_COMPLETED,
  SetupDocumentImportStages.FIELD_MAPPING_STARTED,
  SetupDocumentImportStages.FIELD_MAPPING_COMPLETED,
  SetupDocumentImportStages.DERIVED_FIELDS_STARTED,
  SetupDocumentImportStages.DERIVED_FIELDS_COMPLETED,
  SetupDocumentImportStages.DATABASE_SAVE_STARTED,
  SetupDocumentImportStages.DATABASE_SAVE_COMPLETED,
  SetupDocumentImportStages.PARSE_FINISHED_SUCCESSFULLY,
];

