import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { KiSchluesselUnlesbar } from './fehler';

/**
 * API-Schluessel der KI-Anbieter, verschluesselt mit AES-256-GCM.
 *
 * Format: version(1) ‖ iv(12) ‖ tag(16) ‖ chiffretext. Die Anbieter-ID geht als
 * Zusatzangabe (AAD) ein — ein Chiffretext, den jemand in eine andere Zeile kopiert,
 * laesst sich dort nicht entschluesseln.
 *
 * WAS DAS LEISTET: Schutz gegen einen abgeflossenen Datenbank-Dump allein. WAS NICHT:
 * gegen ein abgeflossenes Gesamt-Backup — ein Backup des Projektverzeichnisses enthaelt
 * auch die .env mit SECRETS_KEY.
 *
 * Liest process.env und nicht $env: dieselbe Datei laeuft im Worker.
 */
const VERSION = 1;
const IV = 12;
const TAG = 16;

export class SchluesselFehlt extends Error {
	constructor() {
		super('SECRETS_KEY ist nicht gesetzt — ohne ihn laesst sich kein API-Schluessel speichern.');
		this.name = 'SchluesselFehlt';
	}
}

function schluessel(env: NodeJS.ProcessEnv): Buffer {
	const roh = env.SECRETS_KEY?.trim();
	if (!roh) throw new SchluesselFehlt();
	const k = Buffer.from(roh, 'base64');
	if (k.length !== 32) {
		throw new Error(
			`SECRETS_KEY muss base64-kodiert genau 32 Bytes ergeben, ergibt ${k.length}. ` +
				'Erzeugen mit: openssl rand -base64 32'
		);
	}
	return k;
}

export function geheimnisVorhanden(env: NodeJS.ProcessEnv = process.env): boolean {
	return !!env.SECRETS_KEY?.trim();
}

export function verschluesseln(klartext: string, bindung: string, env: NodeJS.ProcessEnv = process.env): Buffer {
	const k = schluessel(env);
	const iv = randomBytes(IV);
	const c = createCipheriv('aes-256-gcm', k, iv);
	c.setAAD(Buffer.from(bindung, 'utf8'));
	const chiffre = Buffer.concat([c.update(klartext, 'utf8'), c.final()]);
	return Buffer.concat([Buffer.from([VERSION]), iv, c.getAuthTag(), chiffre]);
}

export function entschluesseln(blob: Buffer, bindung: string, env: NodeJS.ProcessEnv = process.env): string {
	const k = schluessel(env);
	if (blob.length < 1 + IV + TAG || blob[0] !== VERSION) {
		throw new KiSchluesselUnlesbar('Gespeicherter Schluessel hat ein unbekanntes Format — bitte neu eingeben.');
	}
	try {
		const d = createDecipheriv('aes-256-gcm', k, blob.subarray(1, 1 + IV));
		d.setAAD(Buffer.from(bindung, 'utf8'));
		d.setAuthTag(blob.subarray(1 + IV, 1 + IV + TAG));
		return Buffer.concat([d.update(blob.subarray(1 + IV + TAG)), d.final()]).toString('utf8');
	} catch {
		throw new KiSchluesselUnlesbar(
			'Gespeicherter Schluessel nicht lesbar — SECRETS_KEY geaendert oder Daten verfaelscht. Bitte neu eingeben.'
		);
	}
}

export function schluesselEnde(klartext: string): string {
	return klartext.slice(-4);
}
