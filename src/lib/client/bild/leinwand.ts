/**
 * Die Bausteine (ecken.ts, entzerren.ts, drehen.ts) am echten Canvas. Das Arbeitsbild ist nach
 * FLAECHE begrenzt (drehen.ts, arbeitsMassstab), nicht nach der langen Seite. Duenn gehalten: alles,
 * was sich pruefen laesst, steckt in den reinen Modulen; hier wird nur gezeichnet und gelesen.
 */
import type { Quad } from '$lib/client/crop';
import { findeBon, graubild } from './ecken';
import { entzerre, zielgroesse } from './entzerren';
import { gedrehteGroesse, arbeitsMassstab } from './drehen';

/** Erkennung auf einem kleinen Abbild: schnell, und fuer den Rand reicht es. */
export const MAX_ERKENNUNG = 320;

/** Zeichnet das Foto gedreht (viertel · 90° + fein) in `ziel`; Ecken ausserhalb werden schwarz. */
export function gedrehtZeichnen(ziel: HTMLCanvasElement, bild: HTMLImageElement, viertel: number, fein: number) {
	const grad = viertel * 90 + fein;
	// Nach Flaeche begrenzt, mit der Drehung: ueber ~16,7 MP liefert Safari keinen Kontext mehr.
	const f = arbeitsMassstab(bild.naturalWidth, bild.naturalHeight, grad);
	const b = Math.round(bild.naturalWidth * f);
	const h = Math.round(bild.naturalHeight * f);
	const g = gedrehteGroesse(b, h, grad);
	ziel.width = g.breite;
	ziel.height = g.hoehe;
	const ctx = ziel.getContext('2d')!;
	ctx.save();
	// Schwarz, nicht weiss: der Bon ist hell, ein heller Rand wuerde mit ihm verschmelzen.
	ctx.fillStyle = '#000';
	ctx.fillRect(0, 0, g.breite, g.hoehe);
	ctx.translate(g.breite / 2, g.hoehe / 2);
	ctx.rotate((grad * Math.PI) / 180);
	ctx.drawImage(bild, -b / 2, -h / 2, b, h);
	ctx.restore();
}

/** Den Bon auf dem Canvas suchen; Ecken in Canvas-Koordinaten oder null. */
export function erkenne(c: HTMLCanvasElement): Quad | null {
	const f = Math.min(1, MAX_ERKENNUNG / Math.max(c.width, c.height));
	const w = Math.max(1, Math.round(c.width * f));
	const h = Math.max(1, Math.round(c.height * f));
	const klein = document.createElement('canvas');
	klein.width = w;
	klein.height = h;
	const ctx = klein.getContext('2d')!;
	ctx.drawImage(c, 0, 0, w, h);
	const q = findeBon(graubild(ctx.getImageData(0, 0, w, h).data, w, h), w, h);
	if (!q) return null;
	const sx = c.width / w;
	const sy = c.height / h;
	return q.map((p) => ({ x: p.x * sx, y: p.y * sy })) as Quad;
}

/** Das Viereck entzerren und als WebP liefern. */
export async function ausschneiden(c: HTMLCanvasElement, quad: Quad): Promise<Blob> {
	const ziel = zielgroesse(quad);
	const quelle = c.getContext('2d')!.getImageData(0, 0, c.width, c.height);
	const bild = entzerre({ daten: quelle.data, breite: c.width, hoehe: c.height }, quad, ziel);
	const aus = document.createElement('canvas');
	aus.width = ziel.breite;
	aus.height = ziel.hoehe;
	// entzerre legt das Feld selbst an — es liegt auf einem gewoehnlichen ArrayBuffer.
	aus.getContext('2d')!.putImageData(new ImageData(bild.daten as Uint8ClampedArray<ArrayBuffer>, ziel.breite, ziel.hoehe), 0, 0);
	const alsBlob = (typ: string, guete: number) =>
		new Promise<Blob>((ok, fehler) =>
			aus.toBlob((b) => (b ? ok(b) : fehler(new Error('Zuschnitt fehlgeschlagen'))), typ, guete)
		);
	let blob = await alsBlob('image/webp', 0.85);
	// Kann der Browser kein WebP schreiben, liefert er still PNG — bei einem langen Bon leicht
	// ueber 12 MB, und eine Ablehnung ist fuer die Warteschlange endgueltig (Pruefung 30.09.2026).
	if (blob.type !== 'image/webp') blob = await alsBlob('image/jpeg', 0.9);
	// Den Speicher gleich freigeben: bei der Mehrfachauswahl stauen sich sonst grosse Leinwaende.
	aus.width = 0;
	aus.height = 0;
	return blob;
}
