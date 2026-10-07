import { describe, it, expect, vi } from 'vitest';
import { dochEinBonAnfrage, nachDochEinBon, NICHT_EINGEREIHT_DOCH_EIN_BON } from './keinBon';

describe('dochEinBonAnfrage', () => {
	it('schickt POST an den Endpunkt', async () => {
		const f = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
		expect(await dochEinBonAnfrage('b1', f as never)).toEqual({ ok: true, eingereiht: true });
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

	// 2.11: vorher wurde aus jedem 200 schlicht { ok: true }.
	it('reicht eingereiht:false weiter', async () => {
		const f = vi.fn(async () => new Response('{"ok":true,"eingereiht":false}', { status: 200 }));
		expect(await dochEinBonAnfrage('b1', f as never)).toEqual({ ok: true, eingereiht: false });
	});
});

describe('nachDochEinBon', () => {
	it('fehlgeschlagen und eingereiht: der Bon wird jetzt gelesen', () => {
		expect(nachDochEinBon('failed', { ok: true, eingereiht: true })).toEqual({ liest: true, meldung: null });
	});
	// 2.11: Bisher hiess das Erfolg — der Bon stand aber wieder auf „fehlgeschlagen".
	it('fehlgeschlagen, aber nicht eingereiht: Meldung statt Erfolg', () => {
		expect(nachDochEinBon('failed', { ok: true, eingereiht: false })).toEqual({
			liest: false,
			meldung: NICHT_EINGEREIHT_DOCH_EIN_BON
		});
	});
	it('gelesener Bon: nur der Hinweis faellt weg, einzureihen war nichts', () => {
		expect(nachDochEinBon('review', { ok: true, eingereiht: false })).toEqual({ liest: false, meldung: null });
	});
	it('reicht die Meldung des Endpunkts weiter', () => {
		expect(nachDochEinBon('failed', { ok: false, meldung: 'Dazu ist schon entschieden worden.' })).toEqual({
			liest: false,
			meldung: 'Dazu ist schon entschieden worden.'
		});
	});
});
