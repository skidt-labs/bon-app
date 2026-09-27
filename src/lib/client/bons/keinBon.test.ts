import { describe, it, expect, vi } from 'vitest';
import { dochEinBonAnfrage } from './keinBon';

describe('dochEinBonAnfrage', () => {
	it('schickt POST an den Endpunkt', async () => {
		const f = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
		expect(await dochEinBonAnfrage('b1', f as never)).toEqual({ ok: true });
		expect(f).toHaveBeenCalledWith('/api/receipts/b1/kein-bon', { method: 'POST' });
	});
	it('gibt die Meldung des Endpunkts weiter', async () => {
		const f = vi.fn(async () => new Response('{"message":"Dazu ist schon entschieden worden."}', { status: 409 }));
		expect(await dochEinBonAnfrage('b1', f as never)).toEqual({ ok: false, meldung: 'Dazu ist schon entschieden worden.' });
	});
	it('faengt einen Netzfehler ab', async () => {
		const f = vi.fn(async () => {
			throw new TypeError('offline');
		});
		expect(await dochEinBonAnfrage('b1', f as never)).toMatchObject({ ok: false });
	});
});
