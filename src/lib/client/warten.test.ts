import { describe, it, expect, vi, afterEach } from 'vitest';
import { NACHLADEN_MS, nachladenAlle, mitWartezustand } from './warten';

afterEach(() => {
	vi.useRealTimers();
});

describe('nachladenAlle', () => {
	it('laedt im Takt von 5 s nach und hoert auf, sobald es beendet wird', async () => {
		vi.useFakeTimers();
		const laden = vi.fn(async () => {});
		const stop = nachladenAlle(NACHLADEN_MS, laden);
		await vi.advanceTimersByTimeAsync(4_999);
		expect(laden).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(laden).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(5_000);
		expect(laden).toHaveBeenCalledTimes(2);
		stop();
		await vi.advanceTimersByTimeAsync(60_000);
		expect(laden).toHaveBeenCalledTimes(2);
	});

	// Ein langsames Neuladen darf sich nicht stauen.
	it('startet die naechste Runde erst, wenn die vorige fertig ist', async () => {
		vi.useFakeTimers();
		let fertig: () => void = () => {};
		const laden = vi.fn(() => new Promise<void>((r) => (fertig = () => r())));
		const stop = nachladenAlle(5_000, laden);
		await vi.advanceTimersByTimeAsync(35_000);
		expect(laden).toHaveBeenCalledTimes(1);
		fertig();
		await vi.advanceTimersByTimeAsync(5_000);
		expect(laden).toHaveBeenCalledTimes(2);
		stop();
	});

	// So endet es in der Pruefansicht: das Neuladen bringt den gelesenen Bon, und der Effekt
	// raeumt die Uhr weg, WAEHREND das Laden noch laeuft.
	it('plant nach dem Beenden waehrend eines Ladens keine Runde mehr', async () => {
		vi.useFakeTimers();
		let fertig: () => void = () => {};
		const laden = vi.fn(() => new Promise<void>((r) => (fertig = () => r())));
		const stop = nachladenAlle(5_000, laden);
		await vi.advanceTimersByTimeAsync(5_000);
		stop();
		fertig();
		await vi.advanceTimersByTimeAsync(60_000);
		expect(laden).toHaveBeenCalledTimes(1);
	});

	it('macht nach einem Fehler beim Laden weiter', async () => {
		vi.useFakeTimers();
		const laden = vi.fn(async () => {
			throw new Error('Netz weg');
		});
		const stop = nachladenAlle(5_000, laden);
		await vi.advanceTimersByTimeAsync(10_000);
		expect(laden).toHaveBeenCalledTimes(2);
		stop();
	});
});

describe('mitWartezustand', () => {
	// 2.7: Vorher wurde der Knopf vor dem Neuladen frei — ein zweiter Klick traf einen Bon,
	// den es so nicht mehr gab.
	it('gibt erst frei, wenn auch das Neuladen fertig ist', async () => {
		const ablauf: string[] = [];
		let neuGeladen: () => void = () => {};
		const lauf = mitWartezustand(
			(an) => ablauf.push(an ? 'gesperrt' : 'frei'),
			async () => {
				ablauf.push('Anfrage');
				await new Promise<void>((r) => (neuGeladen = () => r()));
				ablauf.push('neu geladen');
				return 'ok';
			}
		);
		await Promise.resolve();
		expect(ablauf).toEqual(['gesperrt', 'Anfrage']);
		neuGeladen();
		expect(await lauf).toBe('ok');
		expect(ablauf).toEqual(['gesperrt', 'Anfrage', 'neu geladen', 'frei']);
	});

	it('gibt auch nach einem Fehler frei', async () => {
		const zustand: boolean[] = [];
		await expect(
			mitWartezustand(
				(an) => zustand.push(an),
				async () => {
					throw new Error('weg');
				}
			)
		).rejects.toThrow('weg');
		expect(zustand).toEqual([true, false]);
	});
});
