import { describe, it, expect } from 'vitest';
import { filterAusQuery, statusListe, zaehlerAus } from './liste';

const standardPosteingang = { status: 'brauchtDich', monat: null } as const;

describe('filterAusQuery', () => {
	it('nimmt den Standard, wenn nichts gesetzt ist', () => {
		const { filter, hinweise } = filterAusQuery(new URLSearchParams(), standardPosteingang);
		expect(filter).toEqual({ status: 'brauchtDich', monat: null, haendler: null, suche: null });
		expect(hinweise).toEqual([]);
	});

	it('nimmt gesetzte, brauchbare Werte', () => {
		const p = new URLSearchParams('status=bestaetigt&monat=2026-09&haendler=Frischmarkt&suche=milch');
		const { filter } = filterAusQuery(p, standardPosteingang);
		expect(filter).toEqual({ status: 'bestaetigt', monat: '2026-09', haendler: 'Frischmarkt', suche: 'milch' });
	});

	// Der Kern: ein unbrauchbarer Wert wird NICHT still durch den Standard ersetzt, ohne
	// dass es jemand erfaehrt. Der Filter faellt zurueck, aber ein Hinweis nennt es —
	// die Seite zeigt ihn an. Sonst glaubt der Mensch, er saehe den September, und sieht
	// alles.
	it('faellt bei Unbrauchbarem zurueck und sagt es', () => {
		const p = new URLSearchParams('status=egal&monat=2026-13');
		const { filter, hinweise } = filterAusQuery(p, standardPosteingang);
		expect(filter.status).toBe('brauchtDich');
		expect(filter.monat).toBeNull();
		expect(hinweise).toHaveLength(2);
		expect(hinweise[0]).toContain('egal');
		expect(hinweise[1]).toContain('2026-13');
	});

	it('behandelt Leerraum wie nicht gesetzt', () => {
		const p = new URLSearchParams('haendler=   &suche=');
		const { filter } = filterAusQuery(p, standardPosteingang);
		expect(filter.haendler).toBeNull();
		expect(filter.suche).toBeNull();
	});
});

describe('statusListe', () => {
	// "Braucht dich" ist review UND failed: beides wartet auf einen Menschen. pending und
	// extracting warten auf die Maschine — dieselbe Abgrenzung wie bisher im Posteingang.
	it('uebersetzt die Filter in Bon-Status', () => {
		expect(statusListe('brauchtDich')).toEqual(['review', 'failed']);
		expect(statusListe('wirdGelesen')).toEqual(['pending', 'extracting']);
		expect(statusListe('fehlgeschlagen')).toEqual(['failed']);
		expect(statusListe('bestaetigt')).toEqual(['confirmed']);
		expect(statusListe('alle')).toBeNull();
	});
});

describe('zaehlerAus', () => {
	it('ordnet die Gruppen zu und laesst Fehlendes auf 0', () => {
		const z = zaehlerAus([
			{ status: 'review', n: 7 },
			{ status: 'failed', n: 1 },
			{ status: 'extracting', n: 1 },
			{ status: 'confirmed', n: 42 }
		]);
		expect(z).toEqual({ brauchtDich: 8, wirdGelesen: 1, fehlgeschlagen: 1, bestaetigt: 42 });
	});

	it('ist ohne Bons ueberall 0', () => {
		expect(zaehlerAus([])).toEqual({ brauchtDich: 0, wirdGelesen: 0, fehlgeschlagen: 0, bestaetigt: 0 });
	});
});
