import { afterEach, describe, it, expect, vi } from 'vitest';
import { MenueRegister, MenueRunden, escapeSchliesst, filterwahlEscape, istHandy, HANDY_MEDIEN } from './menue';

/** Attrappe fuer ein <details>: nur, was das Register braucht. */
const menue = (name: string, innen: string[] = []) => ({
	name,
	open: false,
	contains: (ziel: unknown) => ziel === name || innen.includes(ziel as string)
});

/*
 * Am Handy lagen mehrere offene Menues uebereinander (Rueckmeldung 27.09.2026). Die Regel:
 * immer nur EINES offen; Tippen daneben und Escape schliessen es.
 */
describe('MenueRegister', () => {
	it('schliesst beim Oeffnen eines Menues alle anderen', () => {
		const r = new MenueRegister<ReturnType<typeof menue>>();
		const a = menue('a');
		const b = menue('b');
		a.open = true;
		r.geoeffnet(a);
		b.open = true;
		r.geoeffnet(b);
		expect(a.open).toBe(false);
		expect(b.open).toBe(true);
	});

	it('vergisst ein Menue, das sich selbst geschlossen hat', () => {
		const r = new MenueRegister<ReturnType<typeof menue>>();
		const a = menue('a');
		a.open = true;
		r.geoeffnet(a);
		a.open = false;
		r.geschlossen(a);
		const b = menue('b');
		b.open = true;
		r.geoeffnet(b);
		expect(b.open).toBe(true);
		expect(r.anzahlOffen()).toBe(1);
	});

	it('schliesst beim Tippen daneben, nicht beim Tippen hinein', () => {
		const r = new MenueRegister<ReturnType<typeof menue>>();
		const a = menue('a', ['knopf-in-a']);
		a.open = true;
		r.geoeffnet(a);
		r.getippt('knopf-in-a');
		expect(a.open).toBe(true);
		r.getippt('irgendwo');
		expect(a.open).toBe(false);
		expect(r.anzahlOffen()).toBe(0);
	});

	it('schliesst mit Escape und auf Zuruf alle', () => {
		const r = new MenueRegister<ReturnType<typeof menue>>();
		const a = menue('a');
		a.open = true;
		r.geoeffnet(a);
		r.escape();
		expect(a.open).toBe(false);
		const b = menue('b');
		b.open = true;
		r.geoeffnet(b);
		r.alleSchliessen();
		expect(b.open).toBe(false);
	});
});

/** Ein Ausloeser-Ersatz (<summary>): nur `focus`. */
const ausloeser = () => ({ focus: vi.fn() });

/*
 * 1.1: Nach ✕, Escape oder Tippen daneben landete der Fokus am Seitenanfang. Das Register
 * merkt sich den Ausloeser und gibt ihm den Fokus zurueck — aber nur, wenn er sonst verloren
 * waere (im zugegangenen Menue oder nirgends), nie weg von etwas, das daneben getippt wurde.
 */
describe('MenueRegister: Fokus zurueck an den Ausloeser (1.1)', () => {
	it('lag der Fokus im Menue (✕, Escape), geht er an den Ausloeser', () => {
		const r = new MenueRegister<ReturnType<typeof menue>>();
		const a = menue('a', ['schliessen-x']);
		const knopf = ausloeser();
		a.open = true;
		r.geoeffnet(a, knopf);
		a.open = false;
		r.geschlossen(a, { aktiv: 'schliessen-x', nirgends: false });
		expect(knopf.focus).toHaveBeenCalledTimes(1);
	});

	it('lag er nirgends (Seitenanfang nach Tippen ins Leere), ebenso', () => {
		const r = new MenueRegister<ReturnType<typeof menue>>();
		const a = menue('a');
		const knopf = ausloeser();
		a.open = true;
		r.geoeffnet(a, knopf);
		r.getippt('irgendwo');
		r.geschlossen(a, { aktiv: null, nirgends: true });
		expect(knopf.focus).toHaveBeenCalledTimes(1);
	});

	// Abschlusspruefung 0.11.0: am Rechner weggescrollt und daneben geklickt — der Fokus geht
	// zurueck, die Seite springt aber nicht zum Knopf (wie schon bei `abgebaut`).
	it('lag er nirgends, springt die Seite dabei nicht zum Ausloeser', () => {
		const r = new MenueRegister<ReturnType<typeof menue>>();
		const a = menue('a');
		const knopf = ausloeser();
		a.open = true;
		r.geoeffnet(a, knopf);
		r.geschlossen(a, { aktiv: null, nirgends: true });
		expect(knopf.focus).toHaveBeenCalledWith({ preventScroll: true });
	});

	it('wurde daneben etwas Fokussierbares getippt, bleibt der Fokus dort', () => {
		const r = new MenueRegister<ReturnType<typeof menue>>();
		const a = menue('a');
		const knopf = ausloeser();
		a.open = true;
		r.geoeffnet(a, knopf);
		r.getippt('link-daneben');
		r.geschlossen(a, { aktiv: 'link-daneben', nirgends: false });
		expect(knopf.focus).not.toHaveBeenCalled();
	});

	it('geht ein anderes Menue auf, bekommt das erste den Fokus nicht zurueck', () => {
		const r = new MenueRegister<ReturnType<typeof menue>>();
		const a = menue('a');
		const b = menue('b');
		const knopfA = ausloeser();
		a.open = true;
		r.geoeffnet(a, knopfA);
		b.open = true;
		r.geoeffnet(b, ausloeser());
		// Das toggle-Ereignis von a kommt erst danach — und darf b nichts wegnehmen.
		r.geschlossen(a, { aktiv: null, nirgends: true });
		expect(knopfA.focus).not.toHaveBeenCalled();
	});

	it('ohne Fokusangabe (Abbau der Seite) wird nur vergessen', () => {
		const r = new MenueRegister<ReturnType<typeof menue>>();
		const a = menue('a');
		const knopf = ausloeser();
		a.open = true;
		r.geoeffnet(a, knopf);
		r.geschlossen(a);
		r.geschlossen(a, { aktiv: null, nirgends: true });
		expect(knopf.focus).not.toHaveBeenCalled();
		expect(r.anzahlOffen()).toBe(0);
	});

	it('Escape meldet, ob es etwas geschlossen hat', () => {
		const r = new MenueRegister<ReturnType<typeof menue>>();
		expect(r.escape()).toBe(false);
		const a = menue('a');
		a.open = true;
		r.geoeffnet(a);
		expect(r.escape()).toBe(true);
		expect(a.open).toBe(false);
	});
});

/** Ein Tastenziel-Ersatz: nur tagName und type. */
const feld = (tagName: string, type = '') => ({ tagName, type }) as unknown as EventTarget;

/*
 * 1.2: Escape im Datumsfeld der Zeitwahl schloss das ganze Menue. Datums- und Zeitfelder
 * behalten Escape fuer sich, ebenso ein Escape, das schon jemand behandelt hat.
 */
describe('escapeSchliesst (1.2)', () => {
	it('schliesst aus Knoepfen, Links und Textfeldern', () => {
		expect(escapeSchliesst(feld('BUTTON'), false)).toBe(true);
		expect(escapeSchliesst(feld('A'), false)).toBe(true);
		expect(escapeSchliesst(feld('INPUT', 'text'), false)).toBe(true);
		expect(escapeSchliesst(feld('INPUT', 'search'), false)).toBe(true);
		expect(escapeSchliesst(null, false)).toBe(true);
	});

	it('nicht aus Datums- und Zeitfeldern', () => {
		for (const typ of ['date', 'time', 'month', 'week', 'datetime-local']) {
			expect(escapeSchliesst(feld('INPUT', typ), false)).toBe(false);
		}
		expect(escapeSchliesst(feld('input', 'DATE'), false)).toBe(false);
	});

	it('nicht, wenn Escape schon behandelt wurde', () => {
		expect(escapeSchliesst(feld('BUTTON'), true)).toBe(false);
	});
});

/* 1.3: Escape in der Filterwahl leert erst die Suche, das zweite schliesst. */
describe('filterwahlEscape (1.3)', () => {
	it('leert eine nicht leere Suche', () => {
		expect(filterwahlEscape('Bäck')).toBe('leeren');
		expect(filterwahlEscape(' ')).toBe('leeren');
	});
	it('schliesst bei leerer Suche', () => {
		expect(filterwahlEscape('')).toBe('schliessen');
	});
});

/* 1.5: Handy = unter Tailwinds `sm` (40rem); ohne Fenster (Server) nie. */
describe('istHandy (1.5)', () => {
	afterEach(() => vi.unstubAllGlobals());
	it('ohne matchMedia: false', () => {
		vi.stubGlobal('matchMedia', undefined);
		expect(istHandy()).toBe(false);
	});
	it('fragt genau die sm-Grenze ab', () => {
		const frage = vi.fn((q: string) => ({ matches: q === HANDY_MEDIEN }));
		vi.stubGlobal('matchMedia', frage);
		expect(istHandy()).toBe(true);
		expect(frage).toHaveBeenCalledWith('(width < 40rem)');
	});
});

/*
 * Bonliste am Handy: „⋯" → „Wiederherstellen" (Papierkorb) oder „Verwerfen" (Alle). Nach dem
 * Neuladen faellt der Bon aus dem Filter, Karte und Menue werden abgebaut — ohne
 * toggle-Ereignis, und der Ausloeser ist mit weg. Der Fokus stand dann am Seitenanfang (1.1);
 * er geht an ein Ausweichziel der Liste.
 */
describe('MenueRegister: Abbau eines offenen Menues (1.1)', () => {
	it('steht der Fokus danach nirgends, geht er ans Ausweichziel', () => {
		const r = new MenueRegister<ReturnType<typeof menue>>();
		const a = menue('a');
		const knopf = ausloeser();
		const anker = ausloeser();
		a.open = true;
		r.geoeffnet(a, knopf);
		r.abgebaut(a, { aktiv: null, nirgends: true }, anker);
		expect(anker.focus).toHaveBeenCalledTimes(1);
		expect(knopf.focus).not.toHaveBeenCalled();
		expect(r.anzahlOffen()).toBe(0);
	});

	it('steht er woanders, bleibt er dort', () => {
		const r = new MenueRegister<ReturnType<typeof menue>>();
		const a = menue('a');
		const anker = ausloeser();
		a.open = true;
		r.geoeffnet(a, ausloeser());
		r.abgebaut(a, { aktiv: 'link-daneben', nirgends: false }, anker);
		expect(anker.focus).not.toHaveBeenCalled();
	});

	it('war das Menue schon zu, bleibt der Fokus, wo er ist', () => {
		const r = new MenueRegister<ReturnType<typeof menue>>();
		const a = menue('a');
		const anker = ausloeser();
		a.open = true;
		r.geoeffnet(a, ausloeser());
		a.open = false;
		r.geschlossen(a, { aktiv: 'link-daneben', nirgends: false });
		r.abgebaut(a, { aktiv: null, nirgends: true }, anker);
		expect(anker.focus).not.toHaveBeenCalled();
	});

	it('ohne Ausweichziel wird nur vergessen', () => {
		const r = new MenueRegister<ReturnType<typeof menue>>();
		const a = menue('a');
		const knopf = ausloeser();
		a.open = true;
		r.geoeffnet(a, knopf);
		r.abgebaut(a, { aktiv: null, nirgends: true });
		expect(knopf.focus).not.toHaveBeenCalled();
		expect(r.anzahlOffen()).toBe(0);
	});
});

/*
 * 1.6, Bonliste: die zweite Stufe faellt beim Schliessen des Menues zurueck. Kommt die
 * Antwort erst danach (langsames Netz, daneben getippt), darf sie die scharfe Stufe
 * „Trotzdem in den Papierkorb" nicht wieder setzen. Jedes Schliessen beginnt eine neue Runde.
 */
describe('MenueRunden (1.6)', () => {
	it('eine Antwort aus derselben Runde gilt', () => {
		const r = new MenueRunden();
		const runde = r.runde('bon-1');
		expect(r.gilt('bon-1', runde)).toBe(true);
	});

	it('ging das Menue dazwischen zu, gilt sie nicht mehr', () => {
		const r = new MenueRunden();
		const runde = r.runde('bon-1');
		r.zu('bon-1');
		expect(r.gilt('bon-1', runde)).toBe(false);
		expect(r.gilt('bon-1', r.runde('bon-1'))).toBe(true);
	});

	it('das Schliessen eines anderen Menues zaehlt nicht', () => {
		const r = new MenueRunden();
		const runde = r.runde('bon-2');
		r.zu('bon-1');
		expect(r.gilt('bon-2', runde)).toBe(true);
	});
});
