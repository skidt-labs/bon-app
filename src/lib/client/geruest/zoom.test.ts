import { describe, it, expect } from 'vitest';
import { leistenTransform } from './zoom';

describe('leistenTransform', () => {
	it('laesst die Leiste ohne Zoom in Ruhe', () => {
		expect(
			leistenTransform({ offsetLeft: 0, offsetTop: 0, width: 400, height: 800, scale: 1 }, 800)
		).toBeNull();
	});

	// Die Bildschirmtastatur verkleinert den sichtbaren Bereich, ohne zu zoomen. Die
	// Leiste darf dann nicht ueber die Tastatur springen.
	it('bewegt die Leiste nicht, wenn nur die Tastatur offen ist', () => {
		expect(
			leistenTransform({ offsetLeft: 0, offsetTop: 0, width: 400, height: 400, scale: 1 }, 800)
		).toBeNull();
	});

	it('ignoriert Rundungsrauschen knapp ueber 1', () => {
		expect(
			leistenTransform({ offsetLeft: 0, offsetTop: 0, width: 396, height: 792, scale: 1.01 }, 800)
		).toBeNull();
	});

	it('setzt die Leiste beim Zoomen an den unteren Rand des sichtbaren Ausschnitts', () => {
		expect(
			leistenTransform(
				{ offsetLeft: 100, offsetTop: 300, width: 200, height: 400, scale: 2 },
				800
			)
		).toBe('translate(100px, -100px) scale(0.5)');
	});
});
