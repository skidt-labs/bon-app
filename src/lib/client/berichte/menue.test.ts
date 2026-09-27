import { describe, it, expect } from 'vitest';
import { MenueRegister } from './menue';

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
