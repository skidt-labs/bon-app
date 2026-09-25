import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';

/**
 * Begrenzt wird die BREITE, nicht die laengste Kante.
 *
 * Ein Bon ist schmal und lang. Eine Deckelung der laengsten Kante laesst die Hoehe das
 * Budget auffressen und drueckt die Breite beliebig weit nach unten — und die Breite
 * entscheidet, wie viele Pixel auf ein Zeichen entfallen. Am 2026-09-15 nachgemessen:
 * ein echter Bon lag als 276x2000 vor, rund 13 Pixel je Zeichen. Tesseract las daraus
 * kein einziges Feld; zwei breitere Bons (383 und 395 px) las es vollstaendig richtig,
 * einschliesslich der Gewichtswaren-Zeile. Das Cloud-Modell kam mit 276 px noch zurecht,
 * OCR und kleine lokale Modelle nicht.
 *
 * Das Original wird NICHT aufbewahrt: was hier verkleinert wird, ist unwiederbringlich.
 * Deshalb im Zweifel die groessere Zahl.
 *
 * MAX_HEIGHT ist die zweite Decke, damit ein sehr langer Bon nicht beliebig viel Platz
 * und Bild-Tokens kostet. Erst wenn sie greift, schrumpft auch die Breite wieder.
 */
const MAX_WIDTH = 1600;
const MAX_HEIGHT = 8000;
const THUMB_EDGE = 600;

function baseDir(): string {
	return process.env.RECEIPT_DIR ?? './data/receipts';
}

/**
 * Node-Dateisystemfehler (voller Speicher, fehlende Rechte, ...) tragen eine
 * `.code`-Eigenschaft. sharp wirft bei einem kaputten/unlesbaren Bild dagegen einen
 * gewoehnlichen `Error` OHNE dieses Feld — der Fehlertext selbst ist keine stabile
 * Schnittstelle zum Auswerten (sharp gibt keine Garantie auf Wortlaut oder Sprache).
 * Der Unterschied entscheidet ueber Leben und Tod des Fotos: die Outbox
 * (src/lib/client/outbox.ts, PERMANENTLY_REJECTED) loescht ihre einzige Kopie bei
 * einem endgueltigen 422 — bei einem Systemfehler ist am Bild nichts kaputt, nur die
 * Infrastruktur hakt gerade, und das Foto muss erhalten bleiben (Befund R03).
 *
 * Bewusst eine feste Liste bekannter Codes statt einer Mustererkennung ("beginnt mit
 * E"): ein unbekannter Code gilt im Zweifel NICHT als Systemfehler. Ein zu Unrecht
 * angenommener Dekodierfehler kostet ein unnoetiges 422 (Foto weg, aber wenigstens
 * kein haengenbleibender 5xx); ein zu Unrecht angenommener Systemfehler koennte einen
 * Client dagegen dauerhaft denselben unlesbaren Upload wiederholen lassen.
 */
const SYSTEM_FEHLERCODES = new Set([
	'ENOSPC', // Platte voll
	'EACCES', // Schreibrechte fehlen
	'EROFS', // Dateisystem nur lesend eingehaengt
	'EDQUOT', // Kontingent (Quota) ausgeschoepft
	'EIO', // Ein-/Ausgabefehler auf dem Datentraeger
	'EMFILE', // Zu viele offene Dateien (Prozess)
	'ENFILE', // Zu viele offene Dateien (System)
	'ENOENT', // Zielverzeichnis/-pfad verschwunden (z. B. Mount ausgehaengt)
	'EPERM', // Vorgang nicht erlaubt (z. B. unveraenderliches Verzeichnis)
	'ENOTDIR' // Ein Pfadteil ist keine Verzeichnis — Fehlkonfiguration von RECEIPT_DIR
]);

export function istSystemfehler(err: unknown): boolean {
	if (typeof err !== 'object' || err === null) return false;
	const code = (err as { code?: unknown }).code;
	return typeof code === 'string' && SYSTEM_FEHLERCODES.has(code);
}

/**
 * Bilddateien eines geloeschten Bons entfernen.
 *
 * WIRFT NIE. Aufgerufen wird das NACH der Transaktion, in der die Datenbankzeilen schon
 * weg sind — ein Fehler hier darf daran nichts mehr aendern. Zurueck bleibt dann eine
 * verwaiste Datei, auf die nichts mehr zeigt: aergerlich, aber harmlos. Die umgekehrte
 * Reihenfolge waere schlimmer, denn ein Rollback holt keine geloeschte Datei zurueck.
 */
export async function loescheBilder(pfade: string[]): Promise<void> {
	for (const p of pfade) {
		try {
			await rm(join(baseDir(), p), { force: true });
		} catch (err) {
			console.warn('[storage] Bilddatei liess sich nicht entfernen', { pfad: p, err });
		}
	}
}

export function receiptPathFor(relative: string): string {
	return join(baseDir(), relative);
}

export async function storeReceiptImage(
	buf: Buffer,
	at: Date
): Promise<{ imagePath: string; thumbPath: string; width: number }> {
	const year = String(at.getUTCFullYear());
	const month = String(at.getUTCMonth() + 1).padStart(2, '0');
	const folder = join(baseDir(), year, month);
	await mkdir(folder, { recursive: true });

	const id = randomUUID();
	const imagePath = `${year}/${month}/${id}.webp`;
	const thumbPath = `${year}/${month}/${id}.thumb.webp`;

	// `resolveWithObject` liefert `info.width` — die Breite NACH `.rotate()` (EXIF-
	// Ausrichtung angewandt) und NACH dem Resize, also genau die Breite, die
	// Tesseract später tatsächlich zu sehen bekommt (Entwurf E4: die Breite
	// entscheidet über alles). `sharp(buf).metadata()` allein würde das NICHT
	// leisten — das liefert die Rohmasse VOR `.rotate()`/Resize und könnte bei
	// einem hochkant aufgenommenen, aber quer gespeicherten Foto vertauscht sein.
	const { data: original, info } = await sharp(buf)
		.rotate()
		.resize({ width: MAX_WIDTH, height: MAX_HEIGHT, fit: 'inside', withoutEnlargement: true })
		.webp({ quality: 82 })
		.toBuffer({ resolveWithObject: true });
	const thumb = await sharp(buf)
		.rotate()
		.resize({ width: THUMB_EDGE, height: THUMB_EDGE, fit: 'inside', withoutEnlargement: true })
		.webp({ quality: 70 })
		.toBuffer();
	const originalDatei = join(baseDir(), imagePath);
	const thumbDatei = join(baseDir(), thumbPath);
	try {
		await writeFile(originalDatei, original);
		await writeFile(thumbDatei, thumb);
	} catch (err) {
		// Auch ein teilweise geschriebenes Thumbnail darf keinen verwaisten Bon
		// hinterlassen. Der urspruengliche Schreibfehler bleibt fuer den Aufrufer erhalten.
		for (const datei of [originalDatei, thumbDatei]) {
			try {
				await rm(datei, { force: true });
			} catch (cleanupErr) {
				console.warn('[storage] Unvollstaendige Bilddatei liess sich nicht entfernen', { datei, err: cleanupErr });
			}
		}
		throw err;
	}

	return { imagePath, thumbPath, width: info.width };
}
