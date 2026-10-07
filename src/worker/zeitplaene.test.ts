import { describe, it, expect, vi } from 'vitest';
import { PgBoss } from 'pg-boss';
import { QUEUE_KI_PRUEFEN, QUEUE_PAPIERKORB } from '$lib/server/queue/boss';
import type { ProviderKonfig } from '$lib/server/extraction';
import {
	ZEITPLAENE,
	ZEITZONE,
	zeitplaeneEinrichten,
	kiPruefenTakt,
	type KiTaktDeps,
	type ZeitplanBoss
} from './zeitplaene';
import { LEEREN_UM, naechsterLeerlauf } from '$lib/bons/papierkorb';

function fakeBoss() {
	return {
		schedule: vi.fn<ZeitplanBoss['schedule']>(async () => {}),
		work: vi.fn<ZeitplanBoss['work']>(async () => 'arbeiter-id')
	};
}

describe('zeitplaeneEinrichten (4.4)', () => {
	it('legt beide Zeitplaene in Berliner Zeit an', async () => {
		const boss = fakeBoss();
		await zeitplaeneEinrichten(boss, { papierkorb: vi.fn(async () => {}), kiPruefen: vi.fn(async () => {}) });
		expect(boss.schedule.mock.calls).toEqual([
			[QUEUE_PAPIERKORB, '30 4 * * *', null, { tz: 'Europe/Berlin' }],
			[QUEUE_KI_PRUEFEN, '*/5 * * * *', null, { tz: 'Europe/Berlin' }]
		]);
	});

	// pg-boss fragt ohne Angabe alle 2 s nach Arbeit — 43 200 Abfragen am Tag je Warteschlange,
	// fuer einen Auftrag am Tag bzw. alle 5 Minuten.
	it('jede Zeitplan-Warteschlange fragt alle 30 s und ruft ihren Auftrag', async () => {
		const boss = fakeBoss();
		const papierkorb = vi.fn(async () => {});
		const kiPruefen = vi.fn(async () => {});
		await zeitplaeneEinrichten(boss, { papierkorb, kiPruefen });
		expect(boss.work.mock.calls.map(([name, optionen]) => [name, optionen])).toEqual([
			[QUEUE_PAPIERKORB, { pollingIntervalSeconds: 30 }],
			[QUEUE_KI_PRUEFEN, { pollingIntervalSeconds: 30 }]
		]);
		await boss.work.mock.calls[0][2]();
		await boss.work.mock.calls[1][2]();
		expect(papierkorb).toHaveBeenCalledTimes(1);
		expect(kiPruefen).toHaveBeenCalledTimes(1);
	});

	// Die Ausdruecke selbst, mit dem Parser, mit dem pg-boss sie ausloest (previewSchedule braucht
	// weder start() noch Verbindung — gemessen 07.10.2026). Am 25.10.2026 endet die Sommerzeit.
	it('Papierkorb um 04:30 Berliner Zeit, auch am Tag der Zeitumstellung; KI-Pruefung alle 5 Minuten', () => {
		const boss = new PgBoss('postgres://bon:x@db.invalid:5432/bon_test');
		const papierkorb = boss.previewSchedule(ZEITPLAENE.papierkorb.cron, {
			tz: ZEITZONE,
			from: new Date('2026-10-24T00:00:00Z'),
			count: 3
		});
		expect(papierkorb.map((d) => d.toISOString())).toEqual([
			'2026-10-24T02:30:00.000Z',
			'2026-10-25T03:30:00.000Z',
			'2026-10-26T03:30:00.000Z'
		]);
		const ki = boss.previewSchedule(ZEITPLAENE.kiPruefen.cron, { tz: ZEITZONE, from: new Date('2026-10-24T00:01:00Z'), count: 2 });
		expect(ki.map((d) => d.toISOString())).toEqual(['2026-10-24T00:05:00.000Z', '2026-10-24T00:10:00.000Z']);
	});
});

describe('kiPruefenTakt — der 5-Minuten-Takt (4.6)', () => {
	const konfig = { weg: 'text', baseUrl: 'http://mac.invalid/v1', apiKey: '', model: 'm', timeoutMs: 60_000 } as ProviderKonfig;
	const reserve = { kiAnbieterId: 'r1', name: 'Test-Reserve' };
	const seit = new Date('2026-10-07T10:00:00Z');

	function takt(teil: Partial<KiTaktDeps> = {}): KiTaktDeps {
		return {
			aufloesen: vi.fn(async () => ({ reserve, konfig })),
			reserveAktivSeit: vi.fn(async () => seit),
			probe: vi.fn(async () => true),
			zurueckschalten: vi.fn(async () => {}),
			aufraeumen: vi.fn(async () => null),
			konsole: { log: vi.fn(), error: vi.fn() },
			...teil
		};
	}

	it('raeumt ein stehengebliebenes „Reserve aktiv" weg, wenn die Reserve nicht wirkt — ohne Matrix', async () => {
		const d = takt({ aufloesen: vi.fn(async () => ({ reserve: null, konfig })), aufraeumen: vi.fn(async () => ({ seit })) });
		expect(await kiPruefenTakt(d)).toBe('aufgeraeumt');
		expect(d.aufraeumen).toHaveBeenCalledWith('Reserve wirkungslos');
		expect(d.probe).not.toHaveBeenCalled();
		// zurueckschalten ist der Weg MIT Matrix-Meldung („Mac wieder da") — hier nicht.
		expect(d.zurueckschalten).not.toHaveBeenCalled();
	});

	it('ohne wirkende Reserve und ohne Zustand: nichts', async () => {
		const d = takt({ aufloesen: vi.fn(async () => ({ reserve: null, konfig })) });
		expect(await kiPruefenTakt(d)).toBe('nichts');
		expect(d.aufraeumen).toHaveBeenCalledTimes(1);
	});

	it('Reserve liest, Mac antwortet: zurueck mit Anlass „Zeitplan", nichts aufgeraeumt', async () => {
		const d = takt();
		expect(await kiPruefenTakt(d)).toBe('zurueck');
		expect(d.probe).toHaveBeenCalledWith(konfig);
		expect(d.zurueckschalten).toHaveBeenCalledWith(reserve, 'Zeitplan');
		expect(d.aufraeumen).not.toHaveBeenCalled();
	});

	it('Reserve liest, Mac antwortet nicht: weiter', async () => {
		const d = takt({ probe: vi.fn(async () => false) });
		expect(await kiPruefenTakt(d)).toBe('weiter');
		expect(d.zurueckschalten).not.toHaveBeenCalled();
	});

	it('Reserve eingerichtet, liest aber nicht: der Mac wird gar nicht gefragt', async () => {
		const d = takt({ reserveAktivSeit: vi.fn(async () => null) });
		expect(await kiPruefenTakt(d)).toBe('nichts');
		expect(d.probe).not.toHaveBeenCalled();
	});

	it('ein Fehler wird geloggt, nicht geworfen', async () => {
		const d = takt({ aufloesen: vi.fn(async () => Promise.reject(new Error('Datenbank weg'))) });
		expect(await kiPruefenTakt(d)).toBe('fehler');
		expect(d.konsole.error).toHaveBeenCalled();
	});
});

// 2.1: Die Restfrist der Oberflaeche rechnet gegen den naechtlichen Lauf. Sie kann diese Datei
// nicht importieren ($lib/server) — deshalb stehen beide Angaben hier gegeneinander.
describe('Papierkorb-Restfrist und Zeitplan (2.1)', () => {
	it('rechnet mit demselben Lauf, den pg-boss ausloest — auch an beiden Umstellungstagen', () => {
		expect(ZEITPLAENE.papierkorb.cron).toBe(`${LEEREN_UM.minute} ${LEEREN_UM.stunde} * * *`);
		expect(ZEITZONE).toBe(LEEREN_UM.zeitzone);
		const boss = new PgBoss('postgres://bon:x@db.invalid:5432/bon_test');
		for (const von of [
			'2026-03-28T12:00:00Z',
			'2026-03-29T00:30:00Z',
			'2026-03-29T02:30:00Z',
			'2026-10-24T02:30:00Z',
			'2026-10-25T00:30:00Z',
			'2026-10-25T03:29:59Z',
			'2026-12-31T23:59:00Z'
		]) {
			const [erwartet] = boss.previewSchedule(ZEITPLAENE.papierkorb.cron, { tz: ZEITZONE, from: new Date(von), count: 1 });
			expect(naechsterLeerlauf(new Date(von)).toISOString(), von).toBe(erwartet.toISOString());
		}
	});
});
