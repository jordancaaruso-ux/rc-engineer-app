export interface LapImageExtractionResult {
  laps: number[];
  /** Shown when OCR is not wired yet or low confidence. */
  note?: string | null;
  /** For future: bounding boxes, raw text, engine id. */
  meta?: Record<string, unknown>;
}

export interface LapImageExtractor {
  readonly id: string;
  extract(file: File): Promise<LapImageExtractionResult>;
}
