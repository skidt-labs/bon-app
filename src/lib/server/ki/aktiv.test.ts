import { describe, it, expect, vi } from 'vitest';
import { randomBytes } from 'node:crypto';

vi.mock('$lib/server/db', () => ({ db: {} }));

import { erzeugeAufloeser, wechselnderProvider, type KiAnbieterRoh, type AktiverProvider } from './aktiv';
import { verschluesseln } from './geheimnis';
import { BildwegNichtFreigegeben, KiKonfigurationFehler, KiSchluesselUnlesbar } from './fehler';
import { textZielAus, type ProviderKonfig } from '$lib/server/extraction';
import type { Leser, UmschaltDeps } from './umschalten';
import type { TextModellAntwort } from '$lib/server/extraction/ocr-text-provider';
import { pruefeOcrQualitaet } from '$lib/server/ocr/qualitaet';

const SECRETS = { SECRETS_KEY: randomBytes(32).toString('base64') };

function zeile(teil: Partial<KiAnbieterRoh> = {}): KiAnbieterRoh {
	return {
		id: 'a1',
		name: 'MLX zu Hause',
		weg: 'text',
		baseUrl: 'http://mlx.invalid/v1',
		modell: 'qwen',
		schluesselEnc: null,
		zeitlimitMs: 60_000,
		preisEinMicro: 0,
		preisAusMicro: 0,
		...teil
	};
}

function aufbau(opts: { stand?: number; aktivId?: string | null; zeile?: KiAnbieterRoh | null; env?: NodeJS.ProcessEnv }) {
	const zustand = { stand: opts.stand ?? 1, aktivId: opts.aktivId === undefined ? 'a1' : opts.aktivId };
	const gebaut: ProviderKonfig[] = [];
	const log: string[] = [];
	// Das zusammengebaute env-Objekt wird zurueckgegeben (nicht nur opts.env): der
	// Aufloeser haelt GENAU dieses Objekt per Referenz, und ein Test, der die
	// Freigabe nach dem ersten Aufruf entzieht, muss es dort aendern, wo der
	// Aufloeser tatsaechlich nachschaut.
	const env: NodeJS.ProcessEnv = {
		EXTRACTION_PROVIDER: 'ocr-text',
		EXTRACTION_BASE_URL: 'http://env.invalid/v1',
		EXTRACTION_API_KEY: 'env-key',
		EXTRACTION_MODEL: 'env-modell',
		...SECRETS,
		...opts.env
	} as NodeJS.ProcessEnv;
	const aufloesen = erzeugeAufloeser({
		leseStand: async () => ({ ...zustand }),
		leseAnbieter: async () => (opts.zeile === undefined ? zeile() : opts.zeile),
		bauen: ((k: ProviderKonfig) => {
			gebaut.push(k);
			return { id: k.weg === 'bild' ? 'openai-compat' : 'ocr-text', model: k.model, extract: vi.fn() };
		}) as never,
		env,
		log: (z) => log.push(z)
	});
	return { aufloesen, zustand, gebaut, log, env };
}

describe('erzeugeAufloeser', () => {
	it('nimmt ohne aktiven Anbieter die .env', async () => {
		const { aufloesen, gebaut } = aufbau({ aktivId: null });
		const a = await aufloesen();
		expect(a.quelle).toBe('env');
		expect(a.kiAnbieterId).toBeNull();
		expect(gebaut[0]).toMatchObject({ model: 'env-modell', apiKey: 'env-key' });
	});

	it('baut den aktiven Anbieter aus der Oberflaeche und merkt ihn sich bis zum naechsten Stand', async () => {
		const { aufloesen, zustand, gebaut, log } = aufbau({});
		const a = await aufloesen();
		expect(a).toMatchObject({ quelle: 'oberflaeche', kiAnbieterId: 'a1', name: 'MLX zu Hause' });
		await aufloesen();
		expect(gebaut).toHaveLength(1);
		zustand.stand = 2;
		await aufloesen();
		expect(gebaut).toHaveLength(2);
		expect(log.some((z) => z.includes('KI gewechselt auf MLX zu Hause/qwen'))).toBe(true);
	});

	it('nimmt die Preise des Anbieters', async () => {
		const { aufloesen } = aufbau({ zeile: zeile({ preisEinMicro: 690000, preisAusMicro: null }) });
		expect((await aufloesen()).preise).toEqual({ einMicro: 690000, ausMicro: null });
	});

	it('entschluesselt den Schluessel und gibt ihn an den Bau weiter', async () => {
		const enc = verschluesseln('sk-echt', 'a1', SECRETS as NodeJS.ProcessEnv);
		const { aufloesen, gebaut } = aufbau({ zeile: zeile({ schluesselEnc: enc }) });
		await aufloesen();
		expect(gebaut[0].apiKey).toBe('sk-echt');
	});

	it('faellt bei einem unlesbaren Schluessel NICHT auf die .env zurueck', async () => {
		const fremd = verschluesseln('sk', 'a1', { SECRETS_KEY: randomBytes(32).toString('base64') } as NodeJS.ProcessEnv);
		const { aufloesen, gebaut } = aufbau({ zeile: zeile({ schluesselEnc: fremd }) });
		await expect(aufloesen()).rejects.toBeInstanceOf(KiSchluesselUnlesbar);
		expect(gebaut).toHaveLength(0);
	});

	it('faellt bei fehlendem SECRETS_KEY NICHT auf die .env zurueck', async () => {
		const enc = verschluesseln('sk', 'a1', SECRETS as NodeJS.ProcessEnv);
		const { aufloesen, gebaut } = aufbau({ zeile: zeile({ schluesselEnc: enc }), env: { SECRETS_KEY: '' } });
		await expect(aufloesen()).rejects.toBeInstanceOf(KiSchluesselUnlesbar);
		expect(gebaut).toHaveLength(0);
	});

	it('faellt bei einer falschen SECRETS_KEY-Laenge NICHT auf die .env zurueck', async () => {
		// geheimnis.ts wirft hier einen einfachen Error (falsche Laenge, nicht
		// "fehlt") — der muss trotzdem als KiKonfigurationFehler ankommen, sonst
		// haelt istVoruebergehenderFehler den Auftrag faelschlich fuer endgueltig
		// gescheitert statt fuer voruebergehend (Konfigurationsfehler).
		const enc = verschluesseln('sk', 'a1', SECRETS as NodeJS.ProcessEnv);
		const kurz = { SECRETS_KEY: randomBytes(16).toString('base64') };
		const { aufloesen, gebaut } = aufbau({ zeile: zeile({ schluesselEnc: enc }), env: kurz });
		await expect(aufloesen()).rejects.toBeInstanceOf(KiSchluesselUnlesbar);
		expect(gebaut).toHaveLength(0);
	});

	it('meldet einen aktiven Anbieter, den es nicht mehr gibt, statt die .env zu nehmen', async () => {
		const { aufloesen, gebaut } = aufbau({ zeile: null });
		await expect(aufloesen()).rejects.toThrow(/aktive KI-Anbieter a1 fehlt/);
		expect(gebaut).toHaveLength(0);
	});

	it('prueft die Bildweg-Freigabe bei JEDEM Aufruf, auch aus dem Zwischenspeicher', async () => {
		const { aufloesen, gebaut, env } = aufbau({
			zeile: zeile({ weg: 'bild' }),
			env: { EXTRACTION_BILDWEG_BESTAETIGT: 'ja' }
		});
		await aufloesen();
		expect(gebaut).toHaveLength(1);
		// Gleicher Stand — der zweite Aufruf bedient sich aus dem Zwischenspeicher
		// (kein neuer Bau, gebaut bleibt bei 1). Aber die Freigabe ist jetzt weg,
		// und der gemerkte Anbieter darf trotzdem nicht laufen.
		// (Im Betrieb aendert sich die .env nur mit Neustart; die Regel steht trotzdem hier.)
		env.EXTRACTION_BILDWEG_BESTAETIGT = '';
		await expect(aufloesen()).rejects.toBeInstanceOf(BildwegNichtFreigegeben);
		expect(gebaut).toHaveLength(1);
	});
});

describe('erzeugeAufloeser: Konfigurationsfehler bleiben voruebergehend', () => {
	// Nach „Zurueck auf .env" wird die .env erst beim naechsten Auftrag gelesen. Ist sie
	// unvollstaendig, darf das den Bon nicht endgueltig scheitern lassen: der Bon ist nicht
	// schuld, und istVoruebergehenderFehler erkennt nur KiKonfigurationFehler.
	it('macht aus einer unvollstaendigen .env einen KiKonfigurationFehler', async () => {
		const { aufloesen } = aufbau({ aktivId: null, env: { EXTRACTION_MODEL: '' } });
		const f = await aufloesen().catch((e: unknown) => e);
		expect(f).toBeInstanceOf(KiKonfigurationFehler);
		expect((f as Error).message).toMatch(/EXTRACTION_MODEL ist nicht gesetzt/);
		expect((f as Error).cause).toBeInstanceOf(Error);
	});

	it('macht aus einem normalen Fehler beim Bauen einen KiKonfigurationFehler', async () => {
		const ursache = new Error('OCR_PROVIDER ist unbrauchbar');
		const aufloesen = erzeugeAufloeser({
			leseStand: async () => ({ stand: 1, aktivId: 'a1' }),
			leseAnbieter: async () => zeile(),
			bauen: (() => {
				throw ursache;
			}) as never,
			env: { ...SECRETS } as NodeJS.ProcessEnv,
			log: () => {}
		});
		const f = await aufloesen().catch((e: unknown) => e);
		expect(f).toBeInstanceOf(KiKonfigurationFehler);
		expect((f as Error).message).toBe('OCR_PROVIDER ist unbrauchbar');
		expect((f as Error).cause).toBe(ursache);
	});

	it('reicht einen schon passenden Fehler unveraendert durch', async () => {
		const eigener = new BildwegNichtFreigegeben('gesperrt');
		const aufloesen = erzeugeAufloeser({
			leseStand: async () => ({ stand: 1, aktivId: null }),
			leseAnbieter: async () => null,
			bauen: (() => {
				throw eigener;
			}) as never,
			env: { EXTRACTION_BASE_URL: 'http://e.invalid', EXTRACTION_API_KEY: 'k', EXTRACTION_MODEL: 'm' } as NodeJS.ProcessEnv,
			log: () => {}
		});
		expect(await aufloesen().catch((e: unknown) => e)).toBe(eigener);
	});
});

describe('wechselnderProvider', () => {
	it('loest vor jedem extract neu auf und zeigt danach Herkunft und Preise des benutzten Anbieters', async () => {
		const ergebnis = { receipt: {} } as never;
		const a = (id: string, model: string): AktiverProvider => {
			const konfig: ProviderKonfig = { weg: 'text', baseUrl: `http://${id}.invalid/v1`, apiKey: '', model, timeoutMs: 1 };
			const leser: Leser = { rolle: 'haupt', name: id, modell: model, kiAnbieterId: id, preise: { einMicro: 1, ausMicro: 2 }, ziel: () => textZielAus(konfig) };
			return {
				provider: { id: 'ocr-text', model, extract: vi.fn(async () => ergebnis) },
				weg: 'text',
				kiAnbieterId: id,
				name: id,
				quelle: 'oberflaeche',
				preise: { einMicro: 1, ausMicro: 2 },
				konfig,
				reserve: null,
				letzterLeser: () => leser,
				neuerAuftrag: () => {}
			};
		};
		const folge = [a('neu', 'm2')];
		const p = wechselnderProvider(async () => folge.shift()!, a('alt', 'm1'));
		expect(p.model).toBe('m1');
		expect(p.kiAnbieterId).toBe('alt');
		await p.extract(Buffer.from(''));
		expect(p.model).toBe('m2');
		expect(p.kiAnbieterId).toBe('neu');
	});
});

// Cloud-Reserve (Entwurf 2026-10-01): der Aufloeser baut zum Hauptanbieter die Reserve mit.
describe('erzeugeAufloeser mit Reserve', () => {
	const reserveZeile = (teil: Partial<KiAnbieterRoh> = {}): KiAnbieterRoh =>
		zeile({ id: 'r1', name: 'Abacus Reserve', baseUrl: 'http://reserve.invalid/v1', modell: 'flash', preisEinMicro: 300_000, preisAusMicro: 2_500_000, ...teil });

	function aufbauMitReserve(opts: {
		aktivId?: string | null;
		reserveId?: string | null;
		haupt?: KiAnbieterRoh | null;
		reserve?: KiAnbieterRoh | null;
		umschalt?: Partial<UmschaltDeps>;
	}) {
		const zustand = { stand: 1, aktivId: opts.aktivId === undefined ? null : opts.aktivId, reserveId: opts.reserveId === undefined ? 'r1' : opts.reserveId };
		const ueber: unknown[] = [];
		const log: string[] = [];
		const env = {
			EXTRACTION_PROVIDER: 'ocr-text',
			EXTRACTION_BASE_URL: 'http://env.invalid/v1',
			EXTRACTION_API_KEY: 'env-key',
			EXTRACTION_MODEL: 'env-modell',
			...SECRETS
		} as NodeJS.ProcessEnv;
		const umschaltDeps: UmschaltDeps = {
			reserveAktivSeit: async () => new Date(),
			grenzeErreicht: async () => false,
			umschalten: async () => true,
			zurueckschalten: async () => {},
			grenzeMelden: async () => {},
			frage: vi.fn(async (): Promise<TextModellAntwort> => ({ receipt: {} as never, usage: null, raw: {}, servedModel: null, warnings: [] })),
			...opts.umschalt
		};
		const aufloesen = erzeugeAufloeser({
			leseStand: async () => ({ ...zustand }),
			leseAnbieter: async (id) => (id === 'r1' ? (opts.reserve === undefined ? reserveZeile() : opts.reserve) : (opts.haupt === undefined ? zeile() : opts.haupt)),
			bauen: ((k: ProviderKonfig, o: { modellAufruf?: (t: string, q: unknown, s: undefined) => Promise<unknown> } | undefined) => {
				ueber.push(o);
				return {
					id: 'ocr-text',
					model: k.model,
					// Wie der echte Textweg: ein uebergebener Modellaufruf ersetzt das feste Ziel.
					extract: vi.fn(async () => {
						if (o?.modellAufruf) await o.modellAufruf('TEXT', pruefeOcrQualitaet('Milch 1,29\nSumme 1,29\n01.01.2026'), undefined);
						return { receipt: {} } as never;
					})
				};
			}) as never,
			env,
			log: (z) => log.push(z),
			umschalten: () => umschaltDeps
		});
		return { aufloesen, zustand, ueber, log, umschaltDeps };
	}

	it('ohne Reserve: keine Reserve, gelesen hat der Hauptanbieter', async () => {
		const { aufloesen, ueber } = aufbauMitReserve({ reserveId: null });
		const a = await aufloesen();
		expect(a.reserve).toBeNull();
		expect(a.letzterLeser().rolle).toBe('haupt');
		expect(ueber[0]).toBeUndefined();
	});

	it('mit Reserve-Karte auf dem Textweg: Reserve gesetzt, der Bau bekommt einen Modellaufruf', async () => {
		const { aufloesen, ueber } = aufbauMitReserve({});
		const a = await aufloesen();
		expect(a.reserve).toEqual({ kiAnbieterId: 'r1', name: 'Abacus Reserve' });
		expect((ueber[0] as { modellAufruf?: unknown }).modellAufruf).toBeTypeOf('function');
		expect(a.konfig).toMatchObject({ weg: 'text', model: 'env-modell' });
	});

	it('eine Reserve-Karte mit Bildweg wirkt nicht', async () => {
		const { aufloesen, log } = aufbauMitReserve({ reserve: reserveZeile({ weg: 'bild' }) });
		const a = await aufloesen();
		expect(a.reserve).toBeNull();
		expect(log.some((z) => z.includes('Reserve wirkungslos'))).toBe(true);
	});

	it('ein Hauptanbieter mit Bildweg nimmt keine Reserve', async () => {
		const { aufloesen } = aufbauMitReserve({ aktivId: 'a1', haupt: zeile({ weg: 'bild' }) });
		const a = await aufloesen().catch(() => null);
		// Ohne Freigabe wirft der Bildweg ohnehin; mit Freigabe darf trotzdem keine Reserve wirken.
		if (a) expect(a.reserve).toBeNull();
	});

	// Abschlusspruefung 02.10.: ohne Preise zaehlen ihre Laeufe 0 € — die Monatsgrenze griffe nie.
	it('eine Reserve-Karte ohne Preise wirkt nicht', async () => {
		const { aufloesen, log } = aufbauMitReserve({ reserve: reserveZeile({ preisAusMicro: null }) });
		const a = await aufloesen();
		expect(a.reserve).toBeNull();
		expect(log.some((z) => z.includes('Reserve wirkungslos') && z.includes('Preise'))).toBe(true);
	});

	it('eine neue Reserve bei gleichem ki_stand baut neu', async () => {
		const { aufloesen, zustand, ueber } = aufbauMitReserve({ reserveId: null });
		await aufloesen();
		zustand.reserveId = 'r1';
		await aufloesen();
		expect(ueber).toHaveLength(2);
	});

	it('ein unlesbarer Reserve-Schluessel haelt das Aufloesen nicht auf, erst das Lesen wirft', async () => {
		const fremd = verschluesseln('sk', 'r1', { SECRETS_KEY: randomBytes(32).toString('base64') } as NodeJS.ProcessEnv);
		const { aufloesen } = aufbauMitReserve({ reserve: reserveZeile({ schluesselEnc: fremd }) });
		const a = await aufloesen();
		expect(a.reserve).not.toBeNull();
		await expect(a.provider.extract(Buffer.from(''))).rejects.toBeInstanceOf(KiSchluesselUnlesbar);
	});

	// Abschlusspruefung 02.10.: ein Bon, der vor dem Modellaufruf scheitert, erbt sonst die Rolle
	// des vorigen — und traegt einen Cloud-Vermerk, obwohl die Cloud ihn nie sah.
	it('ein neuer Auftrag beginnt wieder beim Hauptanbieter', async () => {
		const { aufloesen } = aufbauMitReserve({});
		const start = await aufloesen();
		const p = wechselnderProvider(aufloesen, start);
		await p.extract(Buffer.from(''));
		expect(p.kiRolle).toBe('reserve');
		p.neuerAuftrag();
		expect(p.kiRolle).toBe('haupt');
		expect(p.kiAnbieterId).toBeNull();
	});

	it('scheitert ein Auftrag vor dem Modellaufruf, traegt er die Rolle des Hauptanbieters', async () => {
		const { aufloesen } = aufbauMitReserve({});
		const start = await aufloesen();
		const p = wechselnderProvider(aufloesen, start);
		await p.extract(Buffer.from(''));
		expect(p.kiRolle).toBe('reserve');
		// Der naechste Bon scheitert an der OCR — kein Modell wurde gefragt.
		vi.mocked(start.provider.extract).mockRejectedValueOnce(new Error('OCR kaputt'));
		await expect(p.extract(Buffer.from(''))).rejects.toThrow('OCR kaputt');
		expect(p.kiRolle).toBe('haupt');
	});

	it('wechselnderProvider zeigt nach einem Lesen durch die Reserve deren Rolle, Modell, Preise und Ziel', async () => {
		const { aufloesen } = aufbauMitReserve({});
		const start = await aufloesen();
		const p = wechselnderProvider(aufloesen, start);
		expect(p.kiRolle).toBe('haupt');
		await p.extract(Buffer.from(''));
		expect(p.kiRolle).toBe('reserve');
		expect(p.model).toBe('flash');
		expect(p.kiAnbieterId).toBe('r1');
		expect(p.preise).toEqual({ einMicro: 300_000, ausMicro: 2_500_000 });
		expect(p.kategorienZiel.baseUrl).toBe('http://reserve.invalid/v1');
	});
});
