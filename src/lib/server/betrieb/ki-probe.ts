import { eq, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { kiAnbieter } from '$lib/server/db/schema';
import { baueProvider, bildwegIstBestaetigt } from '$lib/server/extraction';
import { konfigAusZeile, type KiAnbieterRoh } from '$lib/server/ki/aktiv';
import { entschluesseln } from '$lib/server/ki/geheimnis';
import { TESTBON_SUMME_CENTS, TESTBON_TEXT } from '$lib/server/ki/testbon/text';
import { testbonBild } from '$lib/server/ki/testbon/bild';
import type { OcrAnbieter } from '$lib/server/ocr/anbieter';
import { testErgebnisSpeichern, AnbieterNichtGefunden } from './ki';

/**
 * Den Anbieter an einem ERFUNDENEN Bon pruefen — nie an einem echten, denn der Betreiber
 * sieht nicht hinein. Das Ergebnis landet in ki_anbieter, NICHT in extraction_runs: ein
 * Testlauf ist kein Bon.
 *
 * Beide Anfragen gehen an eine URL, die der Betreiber eingibt, und koennen damit auch
 * interne Adressen erreichen. Bewusst hingenommen: nur der Betreiber hat die Knoepfe, und
 * er hat ohnehin Root.
 *
 * Zeitlimits: „Testen" laeuft mit dem Zeitlimit DES ANBIETERS (`zeitlimit_ms`, beim
 * Speichern schon durch MAX_ZEITLIMIT_MS begrenzt) — dasselbe, mit dem er im Betrieb
 * einen Bon liest. Ein lokales Modell braucht fuer den Testbon gut 45 s; ein festes
 * kuerzeres Limit liesse es nie bestehen und damit nie aktivieren. „Modelle abrufen" ist
 * nur eine Liste und bleibt bei festen 30 s.
 */
const MODELLE_ZEITLIMIT_MS = 30_000;
const MAX_LAENGE = 500;

export function kuerzeUndSchwaerze(text: string, schluessel: string | null): string {
	let t = text;
	if (schluessel && schluessel.length >= 4) t = t.split(schluessel).join('••••');
	t = t.replace(/Bearer\s+\S+/gi, 'Bearer ••••');
	return t.length > MAX_LAENGE ? `${t.slice(0, MAX_LAENGE - 1)}…` : t;
}

/** Der Textweg-Test prueft den ANBIETER, nicht PaddleOCR: die OCR liefert den festen Text. */
const testbonOcr: OcrAnbieter = {
	name: 'paddleocr',
	async lies() {
		return { status: 'gelesen', text: TESTBON_TEXT, engine: 'paddleocr', durationMs: 0, options: { testbon: true } };
	}
};

/**
 * `stand` ist `geaendert_am` als Text — in voller Postgres-Genauigkeit (Mikrosekunden),
 * die ein JS-`Date` nicht haelt. testErgebnisSpeichern vergleicht damit, ob die Zeile
 * noch die getestete ist.
 */
async function zeileLesen(id: string): Promise<KiAnbieterRoh & { stand: string }> {
	const [z] = await db
		.select({
			id: kiAnbieter.id,
			name: kiAnbieter.name,
			weg: kiAnbieter.weg,
			baseUrl: kiAnbieter.baseUrl,
			modell: kiAnbieter.modell,
			schluesselEnc: kiAnbieter.schluesselEnc,
			zeitlimitMs: kiAnbieter.zeitlimitMs,
			preisEinMicro: kiAnbieter.preisEinMicro,
			preisAusMicro: kiAnbieter.preisAusMicro,
			stand: sql<string>`${kiAnbieter.geaendertAm}::text`
		})
		.from(kiAnbieter)
		.where(eq(kiAnbieter.id, id));
	if (!z) throw new AnbieterNichtGefunden();
	return z;
}

export type TestErgebnis = { ok: boolean; text: string };

const euro = (micro: number) => `${(micro / 10_000).toLocaleString('de-DE', { maximumFractionDigits: 3 })} ct`;

/**
 * Der reine Pruefteil: liest nichts aus der Datenbank und speichert nichts. Das Ergebnis
 * ist schon gekuerzt und geschwaerzt (der Schluessel ist nur hier im Klartext bekannt).
 * Eigene Funktion, damit ki-probe.live.test.ts den echten Weg gegen einen echten Anbieter
 * gehen kann, ohne Datenbank.
 */
export async function probeAusfuehren(
	z: KiAnbieterRoh,
	deps: { fetchImpl?: typeof fetch; env?: NodeJS.ProcessEnv } = {}
): Promise<TestErgebnis> {
	const env = deps.env ?? process.env;
	let schluessel: string | null = null;

	const ergebnis = await (async (): Promise<TestErgebnis> => {
		// Auch der Test verschickt beim Bildweg ein Bild, wenn auch ein erfundenes.
		if (z.weg === 'bild' && !bildwegIstBestaetigt(env)) {
			return { ok: false, text: 'Nicht getestet: der Bildweg ist in der .env nicht freigegeben.' };
		}
		try {
			const k = konfigAusZeile(z, env);
			schluessel = k.apiKey || null;
			// Das Zeitlimit des Anbieters, fuer den Bau UND fuer das Signal — siehe Kopf.
			const provider = baueProvider(k, { fetchImpl: deps.fetchImpl, ocrAnbieter: testbonOcr }, env);
			const bild = z.weg === 'bild' ? await testbonBild() : Buffer.from('');
			const beginn = Date.now();
			const r = await provider.extract(bild, AbortSignal.timeout(k.timeoutMs));
			const dauer = ((Date.now() - beginn) / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 });
			if (r.servedModel && r.servedModel !== z.modell) {
				return { ok: false, text: `Es hat ein anderes Modell geantwortet: ${r.servedModel} statt ${z.modell}.` };
			}
			if (r.receipt.totalGrossCents !== TESTBON_SUMME_CENTS) {
				return {
					ok: false,
					text: `Summe falsch gelesen: ${r.receipt.totalGrossCents ?? 'keine'} statt ${TESTBON_SUMME_CENTS} Cent (${dauer} s).`
				};
			}
			const tokens = r.usage ? `, ${r.usage.inputTokens}/${r.usage.outputTokens} Tokens` : '';
			const kosten =
				r.usage && z.preisEinMicro !== null && z.preisAusMicro !== null
					? `, ${euro(Math.round((r.usage.inputTokens * z.preisEinMicro + r.usage.outputTokens * z.preisAusMicro) / 1_000_000))}`
					: '';
			return { ok: true, text: `In Ordnung: ${dauer} s${tokens}${kosten}.` };
		} catch (err) {
			return { ok: false, text: err instanceof Error ? `${err.name}: ${err.message}` : String(err) };
		}
	})();

	return { ok: ergebnis.ok, text: kuerzeUndSchwaerze(ergebnis.text, schluessel) };
}

export const WAEHREND_DES_TESTS_GEAENDERT = 'Der Anbieter wurde während des Tests geändert — bitte erneut testen.';

/**
 * Zeile lesen, pruefen, Ergebnis speichern. Gespeichert wird nur, wenn die Zeile noch den
 * getesteten Stand hat: wer waehrend eines 45-s-Tests die URL oder das Modell aendert,
 * darf nicht einen bestandenen Test fuer die NEUE Einstellung erben.
 */
export async function anbieterTesten(
	id: string,
	userId: string,
	deps: { fetchImpl?: typeof fetch; env?: NodeJS.ProcessEnv } = {}
): Promise<TestErgebnis> {
	const { stand, ...z } = await zeileLesen(id);
	const ergebnis = await probeAusfuehren(z, deps);
	const gespeichert = await testErgebnisSpeichern(id, ergebnis.ok, ergebnis.text, userId, stand);
	if (!gespeichert) return { ok: false, text: WAEHREND_DES_TESTS_GEAENDERT };
	return ergebnis;
}

const ohneSchraegstrich = (u: string) => u.trim().replace(/\/+$/, '');

/**
 * Fuer „Modelle abrufen" an einem bestehenden Anbieter, wenn kein neuer Schluessel
 * eingetippt wurde. Der gespeicherte Schluessel gehoert zur gespeicherten URL: steht im
 * Formular eine ANDERE Basis-URL, wird ohne Schluessel abgerufen — sonst ginge er an eine
 * Adresse, fuer die er nie gedacht war.
 */
export async function gespeicherterSchluessel(
	id: string,
	baseUrl: string,
	env: NodeJS.ProcessEnv = process.env
): Promise<string> {
	const z = await zeileLesen(id);
	if (ohneSchraegstrich(baseUrl) !== ohneSchraegstrich(z.baseUrl)) return '';
	return z.schluesselEnc ? entschluesseln(z.schluesselEnc, z.id, env) : '';
}

export async function modelleAbrufen(
	baseUrl: string,
	schluessel: string,
	fetchImpl: typeof fetch = fetch
): Promise<{ ok: true; modelle: string[] } | { ok: false; grund: string }> {
	try {
		const res = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/models`, {
			headers: { authorization: `Bearer ${schluessel}`, 'user-agent': 'bon-app/1.0' },
			signal: AbortSignal.timeout(MODELLE_ZEITLIMIT_MS)
		});
		if (!res.ok) {
			return { ok: false, grund: kuerzeUndSchwaerze(`Keine Modellliste (HTTP ${res.status}) — Modell bitte eintippen.`, schluessel) };
		}
		const daten = (await res.json()) as { data?: { id?: unknown }[] };
		const modelle = (daten.data ?? []).map((m) => m.id).filter((m): m is string => typeof m === 'string').sort();
		return modelle.length ? { ok: true, modelle } : { ok: false, grund: 'Der Anbieter liefert eine leere Liste — Modell bitte eintippen.' };
	} catch (err) {
		return { ok: false, grund: kuerzeUndSchwaerze(err instanceof Error ? err.message : String(err), schluessel) };
	}
}
