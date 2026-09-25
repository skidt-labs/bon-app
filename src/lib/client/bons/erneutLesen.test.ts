import { describe, it, expect, vi } from 'vitest';
import { erneutLesen } from './erneutLesen';

describe('erneutLesen', () => {
	it('ruft den Endpunkt mit POST und meldet Erfolg', async () => {
		const fetchImpl = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
		const ergebnis = await erneutLesen('bon-1', fetchImpl as unknown as typeof fetch);
		expect(ergebnis).toEqual({ ok: true });
		expect(fetchImpl).toHaveBeenCalledWith('/api/receipts/bon-1/reprocess', { method: 'POST' });
	});

	// SvelteKits error(409, 'text') antwortet mit {"message": "text"} — genau der Satz,
	// den der Endpunkt fuer den Menschen geschrieben hat. Er soll ankommen, nicht ein
	// nackter Statuscode.
	it('gibt die Meldung des Endpunkts weiter', async () => {
		const fetchImpl = vi.fn(
			async () =>
				new Response(JSON.stringify({ message: 'Dieser Bon ist bereits bestätigt und wird nicht erneut ausgelesen.' }), {
					status: 409
				})
		);
		const ergebnis = await erneutLesen('bon-1', fetchImpl as unknown as typeof fetch);
		expect(ergebnis).toEqual({ ok: false, meldung: 'Dieser Bon ist bereits bestätigt und wird nicht erneut ausgelesen.' });
	});

	it('nennt den Status, wenn die Antwort keine Meldung traegt', async () => {
		const fetchImpl = vi.fn(async () => new Response('<html>Gateway Timeout</html>', { status: 504 }));
		const ergebnis = await erneutLesen('bon-1', fetchImpl as unknown as typeof fetch);
		expect(ergebnis.ok).toBe(false);
		if (!ergebnis.ok) expect(ergebnis.meldung).toContain('504');
	});

	it('faengt einen Netzfehler ab', async () => {
		const fetchImpl = vi.fn(async () => {
			throw new TypeError('fetch failed');
		});
		const ergebnis = await erneutLesen('bon-1', fetchImpl as unknown as typeof fetch);
		expect(ergebnis.ok).toBe(false);
		if (!ergebnis.ok) expect(ergebnis.meldung).toContain('Verbindung');
	});
});
