export type OcrDetectionStatus = 'DETECTED' | 'AMBIGUOUS' | 'UNREADABLE';

// Detection is advisory only: the client must let the user confirm or correct
// the code before passing it to the diagnosis flow.
export interface OcrDetectionData {
  status: OcrDetectionStatus;
  code: string | null;
  candidates: string[];
  message: string | null;
  // Tesseract's page-level confidence (0-100). It is a rough OCR quality hint,
  // not a probability that a candidate code is correct.
  ocrConfidence: number;
}
