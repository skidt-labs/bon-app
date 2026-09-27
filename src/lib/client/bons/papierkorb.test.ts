import { describe, it, expect, vi } from 'vitest';
import { papierkorbAktion } from './papierkorb';

describe('papierkorbAktion', () => {
	it('schickt POST an den passenden Endpunkt, mit Rumpf', async () => {
		const f = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
		expect(await papierkorbAktion('b1', 'verwerfen', { bestaetigtWegnehmen: true }, f as never)).toEqual({ ok: true });
		expect(f).toHaveBeenCalledWith('/api/receipts/b1/verwerfen', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: '{"bestaetigtWegnehmen":true}'
		});
	});
	it('gibt die Meldung des Endpunkts weiter', async () => {
		const f = vi.fn(async () => new Response('{"message":"Dieser Bon liegt schon im Papierkorb."}', { status: 409 }));
		expect(await papierkorbAktion('b1', 'verwerfen', {}, f as never)).toEqual({
			ok: false,
			meldung: 'Dieser Bon liegt schon im Papierkorb.'
		});
	});
	it('nennt den Status, wenn keine Meldung kommt', async () => {
		const f = vi.fn(async () => new Response('kaputt', { status: 500 }));
		const r = await papierkorbAktion('b1', 'loeschen', {}, f as never);
		expect(r.ok).toBe(false);
		expect(!r.ok && r.meldung).toContain('500');
	});
	it('faengt einen Netzfehler ab', async () => {
		const f = vi.fn(async () => {
			throw new TypeError('offline');
		});
		expect(await papierkorbAktion('b1', 'wiederherstellen', {}, f as never)).toMatchObject({ ok: false });
	});
});
