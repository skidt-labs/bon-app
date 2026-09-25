import { describe, it, expect, vi } from 'vitest';
import { randomBytes } from 'node:crypto';

// Keine Datenbank: probeAusfuehren liest und schreibt nichts. Der Mock stellt sicher, dass
// auch kein Import versehentlich eine Verbindung aufbaut.
vi.mock('$lib/server/db', () => ({ db: {} }));

import { probeAusfuehren } from './ki-probe';
import { verschluesseln } from '$lib/server/ki/geheimnis';
import { zeitlimitAusEnv } from '$lib/server/extraction';
import type { KiAnbieterRoh } from '$lib/server/ki/aktiv';

/**
 * Der Testknopf gegen einen ECHTEN Anbieter (Spec, Abschnitt Tests: „Mit echtem Anbieter").
 * Hinter RUN_OCR_LIVE=1, nicht Teil der normalen Suite:
 *
 *   set -a; . ./.env; set +a; RUN_OCR_LIVE=1 npx vitest run src/lib/server/betrieb/ki-probe.live.test.ts
 *
 * Geschickt wird NUR der erfundene Testbon-Text (testbon/text.ts) an EXTRACTION_BASE_URL —
 * kein echter Bon, keine Datenbank. Der Anbieter wird wie eine Zeile aus ki_anbieter gebaut;
 * der Schluessel aus der .env wird dafuer mit einem Wegwerf-SECRETS_KEY verschluesselt, so
 * laeuft auch das Entschluesseln den echten Weg (konfigAusZeile), ohne dass die Probe einen
 * Sonderweg fuer Klartext-Schluessel braeuchte.
 */
const AUS = process.env.RUN_OCR_LIVE !== '1';

describe.skipIf(AUS)('Testknopf gegen den echten Anbieter aus der .env', () => {
	const zeitlimitMs = zeitlimitAusEnv(process.env.EXTRACTION_TIMEOUT_MS);

	it(
		'besteht den erfundenen Testbon auf dem Textweg',
		async () => {
			const baseUrl = process.env.EXTRACTION_BASE_URL ?? '';
			const modell = process.env.EXTRACTION_MODEL ?? '';
			const apiKey = process.env.EXTRACTION_API_KEY ?? '';
			expect(baseUrl, 'EXTRACTION_BASE_URL fehlt').not.toBe('');
			expect(modell, 'EXTRACTION_MODEL fehlt').not.toBe('');

			const env = { ...process.env, SECRETS_KEY: randomBytes(32).toString('base64') } as NodeJS.ProcessEnv;
			const id = 'live-test';
			const z: KiAnbieterRoh = {
				id,
				name: 'Live-Test (.env)',
				weg: 'text',
				baseUrl,
				modell,
				schluesselEnc: apiKey ? verschluesseln(apiKey, id, env) : null,
				zeitlimitMs,
				preisEinMicro: null,
				preisAusMicro: null
			};

			const beginn = Date.now();
			const r = await probeAusfuehren(z, { env });
			console.log(`[live] ${((Date.now() - beginn) / 1000).toFixed(1)} s, Zeitlimit ${zeitlimitMs} ms: ${JSON.stringify(r)}`);
			expect(r.ok, r.text).toBe(true);
		},
		zeitlimitMs + 10_000
	);
});
