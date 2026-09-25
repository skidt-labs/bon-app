import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ zeile: null as any, geschrieben: [] as unknown[] }));

vi.mock('$lib/server/db', () => ({
	db: {
		select: () => ({ from: () => ({ where: () => Promise.resolve(mocks.zeile ? [mocks.zeile] : []) }) }),
		insert: () => ({
			values: (w: unknown) => ({
				onConflictDoUpdate: () => {
					mocks.geschrieben.push(w);
					return Promise.resolve();
				}
			})
		})
	}
}));

// W5 (Korrekturrunde 3): `nimmBildAuf` selbst braucht keinen Homeserver (eigene
// Tests in ingest.test.ts) — hier interessiert nur, wie `behandleNachricht` mit
// dessen ERGEBNIS umgeht, wenn das Senden der Bestätigung scheitert. Der Rest von
// `./ingest` bleibt echt (u. a. `pruefeAngekuendigteGroesse`, das `behandleNachricht`
// vor jedem Download aufruft).
vi.mock('./ingest', async (importOriginal) => {
	const echt = await importOriginal<typeof import('./ingest')>();
	return { ...echt, nimmBildAuf: vi.fn() };
});
vi.mock('$lib/server/matrix/pairing', () => ({ codeEinloesen: vi.fn() }));
vi.mock('$lib/server/notify', () => ({ notifyMatrix: vi.fn(async () => {}) }));

import { PostgresStorageProvider } from './storage';
import { erzeugeSpeicherWrapper, istAbsenderVomServer, serverVonMatrixId, pruefeStoreTypeSqlite, behandleNachricht } from './client';
import { nimmBildAuf } from './ingest';
import { notifyMatrix } from '$lib/server/notify';
import type { MatrixClient } from 'matrix-bot-sdk';

// K1 (Korrekturrunde 2): Regressionsschutz für den Kern des Fixes — der Herzschlag
// darf NUR entstehen, wenn die SDK diesen Wrapper tatsächlich aufruft (nach einem
// erfolgreichen Sync), niemals aus einem eigenen Zeitgeber. `client.ts` selbst lässt
// sich ohne echten Homeserver nicht prüfen (Entwurf, Abschnitt „Prüfbarkeit"); dieser
// isolierte Ausschnitt schon.
describe('erzeugeSpeicherWrapper (K1: der Herzschlag misst den richtigen Puls)', () => {
	beforeEach(() => {
		mocks.zeile = null;
		mocks.geschrieben = [];
	});

	it('schreibt Token UND Herzschlag, sobald die SDK setSyncToken ruft', async () => {
		const speicher = new PostgresStorageProvider();
		await speicher.laden();
		const laufend: Promise<void>[] = [];
		const wrapper = erzeugeSpeicherWrapper(speicher, (fn) => {
			laufend.push(fn());
		});

		wrapper.setSyncToken('s_neu');
		await Promise.all(laufend);

		expect(mocks.geschrieben).toHaveLength(1);
		expect(mocks.geschrieben[0]).toMatchObject({ sinceToken: 's_neu' });
		expect((mocks.geschrieben[0] as { lastSyncAt: Date }).lastSyncAt).toBeInstanceOf(Date);
	});

	// Der eigentliche Kern von K1: ohne einen Aufruf durch die SDK darf NICHTS
	// geschrieben werden — kein Zeitgeber, der von selbst „lebt" behauptet.
	it('schreibt nichts, solange die SDK setSyncToken nicht ruft', async () => {
		const speicher = new PostgresStorageProvider();
		await speicher.laden();
		erzeugeSpeicherWrapper(speicher, (fn) => {
			void fn();
		});
		expect(mocks.geschrieben).toHaveLength(0);
	});

	it('loggt, wenn das Sichern fehlschlägt, statt die Ereigniskette zu unterbrechen', async () => {
		const speicher = new PostgresStorageProvider();
		await speicher.laden();
		vi.spyOn(speicher, 'sichern').mockRejectedValueOnce(new Error('DB weg'));
		const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {});
		const laufend: Promise<void>[] = [];
		const wrapper = erzeugeSpeicherWrapper(speicher, (fn) => {
			laufend.push(fn());
		});

		wrapper.setSyncToken('s_x');
		await Promise.all(laufend);

		expect(consoleErr).toHaveBeenCalled();
		consoleErr.mockRestore();
	});
});

// W2a (Korrekturrunde 2): `content.is_direct` setzt der Einladende selbst — kein vom
// Server geprüftes Merkmal. Ein föderierender Homeserver lässt jeden Matrix-Nutzer
// weltweit den Bot per Einladung in einen Raum ziehen. Die Beschränkung auf den
// eigenen Homeserver ist die erste von drei Massnahmen (W2b/W2c schliessen den Rest).
describe('serverVonMatrixId', () => {
	it('liest den Server aus einer Matrix-Kennung', () => {
		expect(serverVonMatrixId('@bon:example.org')).toBe('example.org');
		expect(serverVonMatrixId('@bon:Example.ORG')).toBe('example.org');
		expect(serverVonMatrixId('@bon:matrix.example.org:8448')).toBe('matrix.example.org:8448');
	});

	it('gibt null für alles, was keine Matrix-Kennung ist', () => {
		expect(serverVonMatrixId('bon:example.org')).toBeNull();
		expect(serverVonMatrixId('@:example.org')).toBeNull();
		expect(serverVonMatrixId('@bon:')).toBeNull();
		expect(serverVonMatrixId('@bon')).toBeNull();
	});
});

describe('istAbsenderVomServer (W2a)', () => {
	it('lässt einen Absender vom eigenen Server durch', () => {
		expect(istAbsenderVomServer('@erika:example.org', 'example.org')).toBe(true);
	});

	it('weist einen föderierten Absender von einem fremden Homeserver ab', () => {
		expect(istAbsenderVomServer('@fremd:matrix.org', 'example.org')).toBe(false);
	});

	// Gegenprobe gegen einen naiven `.includes('example.org')`: ein Homeserver-Name, der
	// nur ZUFÄLLIG auf ".example.org" endet oder die Zeichenkette woanders trägt, darf
	// nicht durchrutschen.
	it('lässt sich nicht durch einen ähnlichen Domainnamen täuschen', () => {
		expect(istAbsenderVomServer('@fremd:evil-example.org', 'example.org')).toBe(false);
		expect(istAbsenderVomServer('@fremd:example.org.evil.example', 'example.org')).toBe(false);
		expect(istAbsenderVomServer('@fremd:notexample.org', 'example.org')).toBe(false);
		expect(istAbsenderVomServer('@fremd:sub.example.org', 'example.org')).toBe(false);
	});

	it('weist ab, solange der eigene Server unbekannt ist', () => {
		expect(istAbsenderVomServer('@erika:example.org', null)).toBe(false);
	});

	it('weist einen fehlenden Absender ab', () => {
		expect(istAbsenderVomServer(undefined, 'example.org')).toBe(false);
	});
});

// Kleinbefund (Korrekturrunde 2, "sofort"): der hartkodierte Ersatzwert `0` für
// StoreType.Sqlite bricht bei einem npm update lautlos, ohne dass ein Test rot
// wird. Diese Zusicherung prüft gegen die TATSÄCHLICH installierte Fassung von
// @matrix-org/matrix-sdk-crypto-nodejs — genau der Test, den es vorher nicht gab.
describe('pruefeStoreTypeSqlite (Kleinbefund: StoreType-Ersatzwert)', () => {
	it('läuft ohne zu werfen, solange StoreType.Sqlite in der installierten Fassung 0 ist', () => {
		expect(() => pruefeStoreTypeSqlite()).not.toThrow();
	});
});

/**
 * W5 (Korrekturrunde 3, Ruling-Umkehr): Löschen NUR, wenn die Bestätigung
 * nachweislich zugestellt wurde. Vorher lief `redactEvent` immer, sobald
 * `nimmBildAuf` 'aufgenommen' meldete — auch wenn `client.sendText` scheiterte.
 * Das erzeugte den Schaden (Foto weg, keine Bestätigung, Doppel-Bon-Risiko), den
 * die ursprüngliche Entscheidung (Aufgabe 5, W2) vermeiden wollte.
 */
describe('behandleNachricht (W5: Löschen hängt an der zugestellten Bestätigung)', () => {
	function fakeClient(overrides: Record<string, unknown> = {}) {
		return {
			getUserId: vi.fn(async () => '@bon:example.org'),
			crypto: { decryptMedia: vi.fn(async () => Buffer.alloc(1024, 7)) },
			downloadContent: vi.fn(async () => ({ data: Buffer.alloc(1024, 7) })),
			sendText: vi.fn(async () => {}),
			redactEvent: vi.fn(async () => {}),
			...overrides
		} as unknown as MatrixClient;
	}

	const bildEreignis = {
		sender: '@erika:example.org',
		event_id: '$ereignis1',
		origin_server_ts: Date.now(),
		content: { msgtype: 'm.image', file: {} as never }
	};

	beforeEach(() => {
		vi.mocked(nimmBildAuf).mockReset();
		vi.mocked(notifyMatrix).mockClear();
	});

	it('löscht das Medium, wenn die Bestätigung zugestellt wurde', async () => {
		vi.mocked(nimmBildAuf).mockResolvedValue({ art: 'aufgenommen', receiptId: 'r1' });
		const client = fakeClient();

		await behandleNachricht(client, '!raum:example.org', bildEreignis);

		expect(client.sendText).toHaveBeenCalled();
		expect(client.redactEvent).toHaveBeenCalledWith('!raum:example.org', '$ereignis1', expect.any(String));
	});

	// Entwurf E4: ein zu schmales Bild ist derselbe Erfolgspfad wie 'aufgenommen' —
	// der Bon ist gespeichert, nur die Antwort trägt zusätzlich eine Warnung. Das
	// Original muss genauso gelöscht werden, sonst läge das Bild doppelt (im
	// Bildspeicher der App UND weiterhin im Matrix-Raum).
	it('löscht das Medium auch bei einem zu schmalen Bild (aufgenommen_zu_klein)', async () => {
		vi.mocked(nimmBildAuf).mockResolvedValue({ art: 'aufgenommen_zu_klein', receiptId: 'r1', breite: 297 });
		const client = fakeClient();

		await behandleNachricht(client, '!raum:example.org', bildEreignis);

		expect(client.sendText).toHaveBeenCalled();
		expect(client.redactEvent).toHaveBeenCalledWith('!raum:example.org', '$ereignis1', expect.any(String));
	});

	// Der eigentliche Kern von W5: scheitert das Senden der Bestätigung (Synapse
	// kurz weg, 429, abgerissene Verbindung), darf das Bild NICHT gelöscht werden —
	// sonst bekommt der Nutzer nichts, während sein Foto verschwindet.
	it('löscht das Medium NICHT, wenn das Senden der Bestätigung scheitert, und alarmiert', async () => {
		vi.mocked(nimmBildAuf).mockResolvedValue({ art: 'aufgenommen', receiptId: 'r1' });
		const client = fakeClient({
			sendText: vi.fn(async () => {
				throw new Error('M_LIMIT_EXCEEDED');
			})
		});

		await behandleNachricht(client, '!raum:example.org', bildEreignis);

		expect(client.redactEvent).not.toHaveBeenCalled();
		expect(notifyMatrix).toHaveBeenCalled();
	});

	// Gegenprobe: ein schon bekanntes Ereignis löst laut Design ohnehin nie eine
	// Redaktion aus (nur 'aufgenommen' tut das) — daran ändert W5 nichts.
	it('löscht bei einem schon bekannten Ereignis nie, unabhängig vom Sendeerfolg', async () => {
		vi.mocked(nimmBildAuf).mockResolvedValue({ art: 'schon_bekannt', receiptId: 'r1' });
		const client = fakeClient();

		await behandleNachricht(client, '!raum:example.org', bildEreignis);

		expect(client.sendText).toHaveBeenCalled();
		expect(client.redactEvent).not.toHaveBeenCalled();
	});
});
