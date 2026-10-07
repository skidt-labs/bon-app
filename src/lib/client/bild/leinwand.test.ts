import { describe, it, expect } from 'vitest';
import { gedrehtZeichnen, ausschnittLeinwand } from './leinwand';

/** Zeichnet nichts, schreibt nur mit — fillRect mit der Farbe, die in dem Moment gilt. */
function attrappe() {
	const protokoll: string[] = [];
	const ctx = {
		fillStyle: '' as string,
		save: () => protokoll.push('save'),
		restore: () => protokoll.push('restore'),
		translate: () => {},
		rotate: () => {},
		fillRect: () => protokoll.push(`fillRect ${ctx.fillStyle}`),
		drawImage: () => protokoll.push('drawImage')
	};
	const leinwand = { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement;
	return { leinwand, protokoll };
}
const foto = { naturalWidth: 300, naturalHeight: 800 } as HTMLImageElement;

describe('gedrehtZeichnen', () => {
	// Die Erkennung braucht den dunklen Rand: der Bon ist hell.
	it('fuellt die Ecken fuer die Erkennung schwarz', () => {
		const a = attrappe();
		gedrehtZeichnen(a.leinwand, foto, 0, 5);
		expect(a.protokoll).toEqual(['save', 'fillRect #000', 'drawImage', 'restore']);
	});
});

describe('ausschnittLeinwand', () => {
	// 2.14a: nach feinem Drehen lagen sonst schwarze Keile im hochgeladenen Bon.
	it('fuellt weiss und hat dieselbe Groesse wie die Leinwand der Erkennung', () => {
		const schwarz = attrappe();
		gedrehtZeichnen(schwarz.leinwand, foto, 1, -7.5);
		const weiss = attrappe();
		const c = ausschnittLeinwand(foto, 1, -7.5, () => weiss.leinwand);
		expect(c).toBe(weiss.leinwand);
		expect(weiss.protokoll).toEqual(['save', 'fillRect #fff', 'drawImage', 'restore']);
		// Gleiche Masse: das Viereck aus der Erkennung passt ohne Umrechnung.
		expect({ b: c.width, h: c.height }).toEqual({ b: schwarz.leinwand.width, h: schwarz.leinwand.height });
		expect(c.width).toBeGreaterThan(800);
	});
});
