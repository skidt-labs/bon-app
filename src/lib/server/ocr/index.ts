export { ocrLesen, OCR_ZEITLIMIT_MS } from './lesen';
export type { OcrErgebnis, ExecFileImpl } from './lesen';
export { pruefeOcrQualitaet } from './qualitaet';
export type { OcrQualitaet } from './qualitaet';
export { erzeugeTesseractAnbieter } from './anbieter';
export type {
	OcrAnbieter,
	OcrAnbieterErgebnis,
	OcrEngineName,
	OcrLeseOptionen,
	OcrBox,
	OcrZeile,
	OcrWort
} from './anbieter';
export { ocrEngineAusEnv, mitBoxenAusEnv, waehleOcrAnbieter, ocrKonfigurationAusEnv } from './konfiguration';
