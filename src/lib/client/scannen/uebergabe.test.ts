import { describe, it, expect } from 'vitest';
import { uebergeben, abholen } from './uebergabe';

describe('uebergabe', () => {
	it('gibt nichts heraus, solange nichts uebergeben wurde', () => {
		expect(abholen()).toBeNull();
	});

	it('reicht die Fotos samt Quelle genau einmal weiter', () => {
		const f = new File(['x'], 'bon.jpg', { type: 'image/jpeg' });
		uebergeben([f], 'upload');
		expect(abholen()).toEqual({ dateien: [f], quelle: 'upload' });
		// Ein zweites Abholen (Zurueck-Navigation, erneutes Oeffnen von /scan) darf
		// dieselben Fotos nicht noch einmal zum Zuschneiden vorlegen.
		expect(abholen()).toBeNull();
	});

	it('nimmt bei zwei Uebergaben die letzte', () => {
		const a = new File(['a'], 'a.jpg');
		const b = new File(['b'], 'b.jpg');
		uebergeben([a], 'upload');
		uebergeben([b], 'camera');
		expect(abholen()).toEqual({ dateien: [b], quelle: 'camera' });
	});

	it('uebergibt keine leere Auswahl', () => {
		uebergeben([], 'camera');
		expect(abholen()).toBeNull();
	});
});
