import { describe, it, expect, vi, afterEach } from 'vitest';
import {
	berichtsdienstStarten,
	bossAbstand,
	stoppFrist,
	BOSS_ABSTAENDE_MS,
	TEXT_BERICHTE_AUS,
	TEXT_BERICHTE_WIEDER,
	type Stoppbar
} from './berichtsdienst';

const boss = () => ({ stop: vi.fn(async (_o: { graceful: boolean; timeout: number }) => {}) });
/** Wartet nicht wirklich, merkt sich nur die Abstaende. */
const sofort = () => vi.fn(async (_ms: number, _signal: AbortSignal) => {});
/** Wartet, bis beendet wird — wie das echte Warten mit Signal. */
const bisZumAbbruch = (_ms: number, signal: AbortSignal) =>
	new Promise<void>((_, nein) => {
		if (signal.aborted) return nein(signal.reason);
		signal.addEventListener('abort', () => nein(signal.reason), { once: true });
	});

afterEach(() => vi.restoreAllMocks());

describe('bossAbstand', () => {
	it('waechst und bleibt dann beim letzten Wert', () => {
		expect([0, 1, 2, 3, 4].map(bossAbstand)).toEqual([10_000, 30_000, 60_000, 120_000, 300_000]);
		expect(bossAbstand(BOSS_ABSTAENDE_MS.length)).toBe(300_000);
		expect(bossAbstand(99)).toBe(300_000);
	});
});

describe('stoppFrist', () => {
	// compose.yaml: stop_grace_period 30s. Die Kette darf bis 20 s brauchen (SHUTDOWN_KETTE_TIMEOUT_MS),
	// pg-boss bekommt den Rest bis 25 s — aber nie weniger als 1 s.
	it('gibt pg-boss den Rest bis 25 s', () => {
		expect(stoppFrist(0)).toBe(25_000);
		expect(stoppFrist(20_000)).toBe(5_000);
		expect(stoppFrist(30_000)).toBe(1_000);
	});
});

describe('berichtsdienstStarten (Sammelfassung 4.7)', () => {
	it('startet ohne Meldung, wenn pg-boss gleich da ist', async () => {
		const melden = vi.fn(async (_t: string) => {});
		const dienst = berichtsdienstStarten({ starten: async () => boss(), melden, warten: sofort() });
		expect(await dienst.bereit).toBe(true);
		expect(melden).not.toHaveBeenCalled();
	});

	it('meldet einen Fehlstart einmal, versucht es mit wachsendem Abstand erneut und meldet die Rueckkehr', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const starten = vi
			.fn<() => Promise<Stoppbar>>()
			.mockRejectedValueOnce(new Error('pg-boss: Verbindung abgelehnt'))
			.mockRejectedValueOnce(new Error('pg-boss: Verbindung abgelehnt'))
			.mockResolvedValueOnce(boss());
		const melden = vi.fn(async (_t: string) => {});
		const warten = sofort();
		const dienst = berichtsdienstStarten({ starten, melden, warten });
		expect(await dienst.bereit).toBe(true);
		expect(starten).toHaveBeenCalledTimes(3);
		expect(warten.mock.calls.map((c) => c[0])).toEqual([10_000, 30_000]);
		expect(melden.mock.calls.map((c) => c[0])).toEqual([TEXT_BERICHTE_AUS, TEXT_BERICHTE_WIEDER]);
	});

	it('gibt nicht auf, wenn auch die Meldung an Matrix scheitert', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const starten = vi.fn<() => Promise<Stoppbar>>().mockRejectedValueOnce(new Error('weg')).mockResolvedValueOnce(boss());
		const melden = vi.fn(async (_t: string) => {
			throw new Error('Synapse weg');
		});
		const dienst = berichtsdienstStarten({ starten, melden, warten: sofort() });
		expect(await dienst.bereit).toBe(true);
	});

	it('stoppt pg-boss beim Beenden sauber, mit der uebergebenen Frist', async () => {
		const b = boss();
		const dienst = berichtsdienstStarten({ starten: async () => b, melden: vi.fn(async () => {}), warten: sofort() });
		await dienst.bereit;
		await dienst.beenden(12_000);
		expect(b.stop).toHaveBeenCalledWith({ graceful: true, timeout: 12_000 });
	});

	it('wirft beim Beenden nicht, wenn das Stoppen scheitert', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const b = boss();
		b.stop.mockRejectedValueOnce(new Error('Pool schon zu'));
		const dienst = berichtsdienstStarten({ starten: async () => b, melden: vi.fn(async () => {}), warten: sofort() });
		await dienst.bereit;
		await expect(dienst.beenden(5_000)).resolves.toBeUndefined();
	});

	it('bricht das Warten beim Beenden ab und versucht es danach nicht mehr', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const starten = vi.fn(async (): Promise<Stoppbar> => {
			throw new Error('weg');
		});
		const warten = vi.fn(bisZumAbbruch);
		const dienst = berichtsdienstStarten({ starten, melden: vi.fn(async () => {}), warten });
		await vi.waitFor(() => expect(warten).toHaveBeenCalledTimes(1));
		await dienst.beenden(5_000);
		expect(await dienst.bereit).toBe(false);
		expect(starten).toHaveBeenCalledTimes(1);
	});

	it('stoppt einen pg-boss, der erst nach dem Beenden fertig gestartet ist', async () => {
		const b = boss();
		let fertig!: (x: Stoppbar) => void;
		const dienst = berichtsdienstStarten({
			starten: () => new Promise<Stoppbar>((r) => (fertig = r)),
			melden: vi.fn(async () => {}),
			warten: sofort()
		});
		await dienst.beenden(5_000);
		fertig(b);
		expect(await dienst.bereit).toBe(false);
		expect(b.stop).toHaveBeenCalledWith({ graceful: true, timeout: 5_000 });
	});
});
