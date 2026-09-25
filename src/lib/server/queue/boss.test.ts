import { describe, it, expect, vi, beforeEach } from 'vitest';

const start = vi.fn();
const createQueue = vi.fn();
const stop = vi.fn();
const send = vi.fn();

vi.mock('pg-boss', () => ({
	PgBoss: vi.fn(function () {
		return { on: vi.fn(), start, createQueue, stop, send };
	})
}));

/** Frische Modulinstanz — boss.ts haelt `instance`/`starting` im Modulzustand. */
async function freshBoss() {
	vi.resetModules();
	return import('./boss');
}

beforeEach(() => {
	vi.clearAllMocks();
	start.mockResolvedValue(undefined);
	createQueue.mockResolvedValue(undefined);
	stop.mockResolvedValue(undefined);
	send.mockResolvedValue(undefined);
	process.env.DATABASE_URL = 'postgres://test/test';
});

describe('Queue-Konstanten', () => {
	it('benennt die Extraktions-Queue stabil', async () => {
		const { QUEUE_EXTRACT } = await freshBoss();
		expect(QUEUE_EXTRACT).toBe('extract-receipt');
	});
});

// Aufgabenstellung, Teil B, Punkt 1: das alte Budget (retryLimit 3, retryDelay 30s)
// gab nach rund 3,5 Minuten auf — ein Mac, der über Nacht aus ist, übersteht das
// nicht. Dieser Test ist am UNVERÄNDERTEN Code (retryLimit: 3, retryDelay: 30,
// kein retryDelayMax) ROT: er erwartet die NEUEN, für eine Nacht bemessenen Werte.
describe('enqueueExtraction — Wiederholungsbudget (Aufgabenstellung, Teil B, Punkt 1)', () => {
	it('wählt ein Wiederholungsbudget, das eine Nacht ohne Mac übersteht', async () => {
		const { enqueueExtraction } = await freshBoss();

		await enqueueExtraction('receipt-1');

		expect(send).toHaveBeenCalledTimes(1);
		const [name, data, options] = send.mock.calls[0] as [string, unknown, Record<string, unknown>];
		expect(name).toBe('extract-receipt');
		expect(data).toEqual({ receiptId: 'receipt-1' });
		// Herleitung/Begründung der Werte: siehe Kommentar bei enqueueExtraction
		// (queue/boss.ts) und Task-4-Bericht — im Mittel rund 12-13 Std. Gesamtbudget.
		expect(options).toMatchObject({
			retryLimit: 15,
			retryDelay: 300,
			retryBackoff: true,
			retryDelayMax: 3600
		});
	});
});

// Wenn createQueue scheitert, ist boss.start() bereits durch: die Instanz haelt einen
// offenen Pool und laufende Intervalle. Ohne das stop() im catch bliebe bei JEDEM
// Fehlversuch ein Zombie zurueck — und getBoss() laedt ausdruecklich zum Wiederholen ein.
describe('Aufraeumen nach gescheitertem Start', () => {
	it('stoppt die Instanz, wenn createQueue scheitert, und reicht den Fehler durch', async () => {
		const { getBoss } = await freshBoss();
		createQueue.mockRejectedValueOnce(new Error('queue kaputt'));

		await expect(getBoss()).rejects.toThrow('queue kaputt');
		expect(stop).toHaveBeenCalledTimes(1);
		expect(stop).toHaveBeenCalledWith({ graceful: false });
	});

	it('verschluckt einen Fehler aus stop() nicht den urspruenglichen Fehler', async () => {
		const { getBoss } = await freshBoss();
		createQueue.mockRejectedValueOnce(new Error('queue kaputt'));
		stop.mockRejectedValueOnce(new Error('stop kaputt'));

		// Der Anrufer muss die URSACHE sehen, nicht den Folgefehler des Aufraeumens.
		await expect(getBoss()).rejects.toThrow('queue kaputt');
	});

	it('haelt den Fehlversuch nicht fest — der naechste Aufruf startet neu', async () => {
		const { getBoss } = await freshBoss();
		createQueue.mockRejectedValueOnce(new Error('einmalig'));

		await expect(getBoss()).rejects.toThrow('einmalig');
		await expect(getBoss()).resolves.toBeDefined();
		expect(start).toHaveBeenCalledTimes(2);
		expect(stop).toHaveBeenCalledTimes(1); // nur der Fehlversuch wurde gestoppt
	});

	it('stoppt nichts, wenn der Start durchlaeuft, und baut nur eine Instanz', async () => {
		const { getBoss } = await freshBoss();

		const a = await getBoss();
		const b = await getBoss();
		expect(a).toBe(b);
		expect(start).toHaveBeenCalledTimes(1);
		expect(stop).not.toHaveBeenCalled();
	});
});
