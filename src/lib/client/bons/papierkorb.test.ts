import { describe, it, expect, vi } from 'vitest';
import { papierkorbAktion, korbAnfrage, nachKorb, nichtEingereiht, NICHT_EINGEREIHT_KORB } from './papierkorb';

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

	// 2.3: mit der Kennung springt die Bonliste in die zweite Stufe, statt beim naechsten
	// Klick wieder in dieselbe Ablehnung zu laufen.
	it('reicht die Kennung brauchtRueckfrage weiter', async () => {
		const f = vi.fn(
			async () => new Response('{"message":"Dieser Bon ist bestätigt …","brauchtRueckfrage":true}', { status: 409 })
		);
		expect(await papierkorbAktion('b1', 'verwerfen', {}, f as never)).toEqual({
			ok: false,
			meldung: 'Dieser Bon ist bestätigt …',
			brauchtRueckfrage: true
		});
	});
	// 2.11: „Aus dem Papierkorb holen" sagt, ob der Bon wirklich neu gelesen wird.
	it('reicht eingereiht und den Zielstatus beim Zurueckholen weiter', async () => {
		const f = vi.fn(async () => new Response('{"ok":true,"eingereiht":false,"status":"pending"}', { status: 200 }));
		expect(await papierkorbAktion('b1', 'wiederherstellen', {}, f as never)).toEqual({
			ok: true,
			eingereiht: false,
			status: 'pending'
		});
	});
});

describe('korbAnfrage', () => {
	it('fragt beim bestaetigten Bon und beim Loeschen erst nach', () => {
		expect(korbAnfrage('verwerfen', 'confirmed', undefined)).toEqual({ nachfragen: 'verwerfen' });
		expect(korbAnfrage('loeschen', 'verworfen', undefined)).toEqual({ nachfragen: 'loeschen' });
		// Die offene zweite Stufe der ANDEREN Aktion zaehlt nicht.
		expect(korbAnfrage('verwerfen', 'confirmed', 'loeschen')).toEqual({ nachfragen: 'verwerfen' });
	});
	it('handelt beim zweiten Klick', () => {
		expect(korbAnfrage('verwerfen', 'confirmed', 'verwerfen')).toEqual({ rumpf: { bestaetigtWegnehmen: true } });
		expect(korbAnfrage('loeschen', 'verworfen', 'loeschen')).toEqual({ rumpf: {} });
	});
	it('legt einen ungeprueften Bon gleich in den Papierkorb und holt ohne Nachfrage zurueck', () => {
		expect(korbAnfrage('verwerfen', 'review', undefined)).toEqual({ rumpf: { bestaetigtWegnehmen: false } });
		expect(korbAnfrage('wiederherstellen', 'verworfen', undefined)).toEqual({ rumpf: {} });
	});
	// 2.3: Die Liste zeigte „Pruefen", inzwischen ist er bestaetigt. Nach dem 409 mit
	// brauchtRueckfrage steht die zweite Stufe offen, und der zweite Klick muss bestaetigen.
	it('schickt nach der Rueckfrage des Servers bestaetigtWegnehmen mit, auch bei veralteter Liste', () => {
		expect(korbAnfrage('verwerfen', 'review', 'verwerfen')).toEqual({ rumpf: { bestaetigtWegnehmen: true } });
	});
});

describe('nachKorb', () => {
	it('springt bei brauchtRueckfrage in die zweite Stufe, ohne den Satz doppelt zu zeigen', () => {
		expect(
			nachKorb('verwerfen', { ok: false, meldung: 'Dieser Bon ist bestätigt … wirklich verwerfen?', brauchtRueckfrage: true })
		).toEqual({ nachfrage: 'verwerfen', meldung: null, hinweis: null, neuLaden: false });
	});
	it('zeigt jeden anderen Fehler an der Zeile und schliesst die zweite Stufe', () => {
		expect(nachKorb('loeschen', { ok: false, meldung: 'Der Bon hat sich gerade geändert.' })).toEqual({
			nachfrage: undefined,
			meldung: 'Der Bon hat sich gerade geändert.',
			hinweis: null,
			neuLaden: false
		});
	});
	it('laedt nach Erfolg neu', () => {
		expect(nachKorb('verwerfen', { ok: true })).toEqual({ nachfrage: undefined, meldung: null, hinweis: null, neuLaden: true });
		expect(nachKorb('wiederherstellen', { ok: true, eingereiht: true, status: 'pending' })).toEqual({
			nachfrage: undefined,
			meldung: null,
			hinweis: null,
			neuLaden: true
		});
	});
	// 2.11: zurueckgeholt, aber nicht eingereiht — der Server stellte ihn auf „fehlgeschlagen".
	it('meldet ein gescheitertes Einreihen beim Zurueckholen', () => {
		expect(nachKorb('wiederherstellen', { ok: true, eingereiht: false, status: 'pending' })).toEqual({
			nachfrage: undefined,
			meldung: null,
			hinweis: NICHT_EINGEREIHT_KORB,
			neuLaden: true
		});
	});
	it('meldet nichts, wenn gar nicht einzureihen war', () => {
		expect(nichtEingereiht({ ok: true, eingereiht: false, status: 'review' })).toBe(false);
		expect(nichtEingereiht({ ok: true, eingereiht: false, status: 'pending' })).toBe(true);
		expect(nichtEingereiht({ ok: false, meldung: 'x' })).toBe(false);
	});
});
