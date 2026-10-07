import { afterEach, describe, expect, it, vi } from 'vitest';
import { dialog, naechsterFokus } from './dialog';

/*
 * Rueckfrage, Bild-Ueberlagerung und Vollbild der Pruefansicht (1.6, 1.7): Fokus hinein,
 * Tab bleibt drin, Escape schliesst nur ungesperrt, beim Schliessen zurueck an den Ausloeser.
 * Ohne jsdom: `document` und `requestAnimationFrame` sind Attrappen mit genau dem, was die
 * Aktion anfasst.
 */
describe('naechsterFokus', () => {
	it('vorwaerts und rueckwaerts im Kreis', () => {
		expect(naechsterFokus(3, 0, false)).toBe(1);
		expect(naechsterFokus(3, 2, false)).toBe(0);
		expect(naechsterFokus(3, 0, true)).toBe(2);
		expect(naechsterFokus(3, 2, true)).toBe(1);
	});
	it('von ausserhalb: erstes bzw. letztes Element', () => {
		expect(naechsterFokus(3, -1, false)).toBe(0);
		expect(naechsterFokus(3, -1, true)).toBe(2);
	});
	it('ein Element bleibt es; keins ergibt -1', () => {
		expect(naechsterFokus(1, 0, false)).toBe(0);
		expect(naechsterFokus(1, 0, true)).toBe(0);
		expect(naechsterFokus(0, -1, false)).toBe(-1);
	});
});

type Knopf = {
	name: string;
	tagName: string;
	disabled: boolean;
	isConnected: boolean;
	focus: () => void;
	getClientRects: () => unknown[];
};
type Taste = { key: string; shiftKey: boolean; target: unknown; defaultPrevented: boolean; preventDefault(): void };

function aufbau(opts: { autofokus?: string; gesperrt?: boolean } = {}) {
	const hoerer: ((e: Taste) => void)[] = [];
	const doc = {
		activeElement: null as unknown,
		body: { name: 'body' },
		addEventListener: (typ: string, f: (e: Taste) => void) => {
			if (typ === 'keydown') hoerer.push(f);
		},
		removeEventListener: (typ: string, f: (e: Taste) => void) => {
			const i = hoerer.indexOf(f);
			if (typ === 'keydown' && i >= 0) hoerer.splice(i, 1);
		}
	};
	const knopf = (name: string): Knopf => {
		const k: Knopf = {
			name,
			tagName: 'BUTTON',
			disabled: false,
			isConnected: true,
			getClientRects: () => [{}],
			focus: () => {
				doc.activeElement = k;
			}
		};
		return k;
	};
	const ausloeser = knopf('ausloeser');
	const abbrechen = knopf('abbrechen');
	const los = knopf('los');
	const innen = [abbrechen, los];
	const node = {
		tabIndex: 0,
		hasAttribute: () => false,
		contains: (x: unknown) => innen.includes(x as Knopf),
		querySelector: (sel: string) => (sel === '[data-autofocus]' ? (innen.find((k) => k.name === opts.autofokus) ?? null) : null),
		querySelectorAll: () => innen,
		focus: () => {
			doc.activeElement = node;
		}
	};
	let rahmen: (() => void) | null = null;
	vi.stubGlobal('document', doc);
	vi.stubGlobal('requestAnimationFrame', (f: () => void) => {
		rahmen = f;
		return 1;
	});
	vi.stubGlobal('cancelAnimationFrame', () => {
		rahmen = null;
	});
	ausloeser.focus();
	const onschliessen = vi.fn();
	const aktion = dialog(node as unknown as HTMLElement, { onschliessen, gesperrt: opts.gesperrt ?? false });
	const druecke = (key: string, extra: { shiftKey?: boolean; target?: unknown } = {}): Taste => {
		const e: Taste = {
			key,
			shiftKey: extra.shiftKey ?? false,
			target: extra.target ?? doc.activeElement,
			defaultPrevented: false,
			preventDefault() {
				e.defaultPrevented = true;
			}
		};
		for (const f of [...hoerer]) f(e);
		return e;
	};
	return { doc, node, ausloeser, abbrechen, los, aktion, onschliessen, druecke, hoerer, ersterRahmen: () => rahmen?.() };
}

describe('dialog (Aktion)', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('setzt den Fokus beim Oeffnen auf [data-autofocus]', () => {
		const t = aufbau({ autofokus: 'los' });
		t.ersterRahmen();
		expect(t.doc.activeElement).toBe(t.los);
	});

	it('ohne [data-autofocus] auf den ersten Knopf', () => {
		const t = aufbau();
		t.ersterRahmen();
		expect(t.doc.activeElement).toBe(t.abbrechen);
	});

	it('ist [data-autofocus] gesperrt, auf den ersten Knopf', () => {
		const t = aufbau({ autofokus: 'los' });
		t.los.disabled = true;
		t.ersterRahmen();
		expect(t.doc.activeElement).toBe(t.abbrechen);
	});

	it('Escape schliesst und gilt als behandelt', () => {
		const t = aufbau();
		const e = t.druecke('Escape');
		expect(t.onschliessen).toHaveBeenCalledTimes(1);
		expect(e.defaultPrevented).toBe(true);
	});

	it('Escape schliesst nicht, solange gesperrt — und erst nach der Freigabe', () => {
		const t = aufbau({ gesperrt: true });
		const e = t.druecke('Escape');
		expect(t.onschliessen).not.toHaveBeenCalled();
		// Trotzdem verbraucht: ein Menue dahinter soll nicht an seiner Stelle zugehen.
		expect(e.defaultPrevented).toBe(true);
		t.aktion.update({ onschliessen: t.onschliessen, gesperrt: false });
		t.druecke('Escape');
		expect(t.onschliessen).toHaveBeenCalledTimes(1);
	});

	it('Escape in einem Datumsfeld gehoert dem Feld', () => {
		const t = aufbau();
		t.druecke('Escape', { target: { tagName: 'INPUT', type: 'date' } });
		expect(t.onschliessen).not.toHaveBeenCalled();
	});

	it('Tab und Umschalt+Tab bleiben im Dialog', () => {
		const t = aufbau();
		t.ersterRahmen();
		expect(t.druecke('Tab').defaultPrevented).toBe(true);
		expect(t.doc.activeElement).toBe(t.los);
		t.druecke('Tab');
		expect(t.doc.activeElement).toBe(t.abbrechen);
		t.druecke('Tab', { shiftKey: true });
		expect(t.doc.activeElement).toBe(t.los);
	});

	it('steht der Fokus draussen, holt Tab ihn hinein', () => {
		const t = aufbau();
		t.druecke('Tab', { shiftKey: true });
		expect(t.doc.activeElement).toBe(t.los);
	});

	it('gibt den Fokus beim Schliessen an den Ausloeser zurueck und hoert auf zu lauschen', () => {
		const t = aufbau();
		t.ersterRahmen();
		t.aktion.destroy();
		expect(t.doc.activeElement).toBe(t.ausloeser);
		expect(t.hoerer).toHaveLength(0);
	});

	it('gibt es den Ausloeser nicht mehr, bleibt der Fokus, wo er ist', () => {
		const t = aufbau();
		t.ersterRahmen();
		t.ausloeser.isConnected = false;
		t.aktion.destroy();
		expect(t.doc.activeElement).toBe(t.abbrechen);
	});
});
