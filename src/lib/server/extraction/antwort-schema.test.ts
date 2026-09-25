import { describe, it, expect } from 'vitest';
import { bonResponseJsonSchema, ANTWORT_PFLICHTFELDER, ANTWORT_PFLICHTFELDER_POSITION } from './schema';

function positionsSchema(s: Record<string, unknown>): Record<string, unknown> {
	const items = (s.properties as Record<string, any>).items;
	const arr = items.anyOf ? items.anyOf.find((x: any) => x.type === 'array') : items;
	return arr.items;
}

describe('Das Antwort-Schema verlangt, was das Modell liefern soll', () => {
	// Der Fehler, gegen den dieser Test steht: unser Zod-Schema ist absichtlich
	// nachsichtig — fast jedes Feld hat einen Rueckfallwert, damit ein Bon nie an
	// einem einzelnen schlechten Feld scheitert. In der Eingaberichtung heisst das
	// "alles darf fehlen". Genau diese Beschreibung ging am 2026-09-15 als GRAMMATIK
	// an das Modell, und es antwortete folgerichtig mit `{}` — drei Ausgabe-Tokens,
	// kein einziges Feld. Was wir beim Lesen annehmen und was wir beim Fragen
	// verlangen, sind zwei verschiedene Dinge.
	it('verlangt alle Kopffelder', () => {
		expect(bonResponseJsonSchema.required).toEqual(ANTWORT_PFLICHTFELDER);
	});

	it('verlangt alle Felder je Position', () => {
		expect(positionsSchema(bonResponseJsonSchema).required).toEqual(ANTWORT_PFLICHTFELDER_POSITION);
	});

	// Ohne diese Zusicherung koennte jemand ein Feld im Zod-Schema umbenennen, und die
	// Pflichtliste zeigte still auf einen Namen, den es nicht mehr gibt — das Modell
	// duerfte das echte Feld dann wieder weglassen.
	it('nennt genau die Felder, die es im Schema wirklich gibt', () => {
		expect([...ANTWORT_PFLICHTFELDER].sort())
			.toEqual(Object.keys(bonResponseJsonSchema.properties as object).sort());
		expect([...ANTWORT_PFLICHTFELDER_POSITION].sort())
			.toEqual(Object.keys((positionsSchema(bonResponseJsonSchema) as any).properties).sort());
	});
});
