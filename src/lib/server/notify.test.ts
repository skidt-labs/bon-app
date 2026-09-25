import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { notifyMatrix } from './notify';

/**
 * K2 (Korrekturrunde 2): `notify.ts` war im gesamten Diff der Matrix-Anbindung nie
 * enthalten — Bestandscode, den kein Einzelreview je geprüft hat, obwohl der
 * lauteste Fehlerpfad des Projekts (E2) darauf aufbaut. Diese Tests decken genau
 * die zwei Löcher aus dem Abschlussbericht ab: eine nicht ausgewertete Antwort und
 * einen unbemerkt still bleibenden Aufruf bei fehlender Konfiguration.
 */
describe('notifyMatrix (K2)', () => {
	const alteEnv = { ...process.env };

	beforeEach(() => {
		process.env.MATRIX_HOMESERVER = 'https://matrix.example.org';
		process.env.MATRIX_ROOM = '!alarme:example.org';
		process.env.MATRIX_TOKEN = 'mct_test_token';
	});

	afterEach(() => {
		process.env = { ...alteEnv };
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('sendet erfolgreich, ohne zu loggen', async () => {
		const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
		vi.stubGlobal('fetch', fetchMock);
		const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {});

		await notifyMatrix('Testalarm');

		expect(fetchMock).toHaveBeenCalledOnce();
		expect(consoleErr).not.toHaveBeenCalled();
	});

	// Der eigentliche K2-Defekt: `fetch` wirft bei 401/403/404 NICHT. Ohne die
	// Auswertung von `res.ok` kehrte notifyMatrix hier erfolgreich zurück, obwohl
	// nichts im Alarmraum ankam — der Alarmweg war tot, ohne dass es auffiel.
	it('loggt laut mit Statuscode, wenn die Antwort nicht ok ist (z. B. widerrufenes Token)', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue(new Response('{"errcode":"M_FORBIDDEN"}', { status: 403, statusText: 'Forbidden' }));
		vi.stubGlobal('fetch', fetchMock);
		const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {});

		await notifyMatrix('Testalarm');

		expect(consoleErr).toHaveBeenCalledWith(expect.stringContaining('403'));
	});

	it('loggt bei einem Netzwerkfehler, statt zu werfen', async () => {
		const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
		vi.stubGlobal('fetch', fetchMock);
		const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {});

		await expect(notifyMatrix('Testalarm')).resolves.toBeUndefined();
		expect(consoleErr).toHaveBeenCalled();
	});

	// Offener Punkt aus dem Bericht: bleibt bewusst still, wenn die Konfiguration
	// fehlt — „wer bewacht den Wächter" ist über denselben Kanal nicht lösbar.
	// Diese Zusicherung ist die Gegenprobe, dass wenigstens KEIN Aufruf mit
	// unvollständigen Daten hinausgeht.
	it('bleibt ohne vollständige Konfiguration still, statt mit leeren Werten zu senden', async () => {
		delete process.env.MATRIX_ROOM;
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);

		await notifyMatrix('Testalarm');

		expect(fetchMock).not.toHaveBeenCalled();
	});
});
