import { describe, it, expect } from 'vitest';
import { bonResponseJsonSchema, ANTWORT_PFLICHTFELDER, ANTWORT_PFLICHTFELDER_POSITION, ANTWORT_PFLICHTFELDER_MWST } from './schema';

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

/** Alle Objekte im Schema, mit Pfad — Wurzel, Positionen, MwSt.-Zeilen und was je dazukommt. */
function objekte(s: unknown, pfad = '(Wurzel)'): { pfad: string; o: Record<string, any> }[] {
	if (!s || typeof s !== 'object') return [];
	const o = s as Record<string, any>;
	const hier = o.type === 'object' || o.properties ? [{ pfad, o }] : [];
	return [...hier, ...Object.entries(o).flatMap(([k, v]) => objekte(v, `${pfad}/${k}`))];
}

function mwstSchema(s: Record<string, unknown>): Record<string, unknown> {
	const v = (s.properties as Record<string, any>).vatSummary;
	const arr = v.anyOf ? v.anyOf.find((x: any) => x.type === 'array') : v;
	return arr.items;
}

// Cloud-Reserve, Vorabtest 01.10.2026: Abacus (RouteLLM) nimmt json_schema nur im strengen
// Modus nach OpenAI-Regeln an — HTTP 400 „The schema inside 'json_schema' must include:
// additionalProperties …". Fuer den Mac ist das nur strenger: keine Zusatzfelder, und die
// MwSt.-Zeilen vollstaendig (jedes ihrer Felder darf null sein).
describe('Das Antwort-Schema taugt fuer den strengen Modus', () => {
	it('verbietet an jedem Objekt Zusatzfelder', () => {
		const ohne = objekte(bonResponseJsonSchema).filter(({ o }) => o.additionalProperties !== false);
		expect(ohne.map((x) => x.pfad)).toEqual([]);
	});

	it('verlangt an jedem Objekt alle seine Felder', () => {
		const luecken = objekte(bonResponseJsonSchema)
			.filter(({ o }) => JSON.stringify([...(o.required ?? [])].sort()) !== JSON.stringify(Object.keys(o.properties ?? {}).sort()))
			.map((x) => x.pfad);
		expect(luecken).toEqual([]);
	});

	it('nennt fuer die MwSt.-Zeilen genau die Felder, die es im Schema wirklich gibt', () => {
		expect(mwstSchema(bonResponseJsonSchema).required).toEqual(ANTWORT_PFLICHTFELDER_MWST);
		expect([...ANTWORT_PFLICHTFELDER_MWST].sort()).toEqual(
			Object.keys((mwstSchema(bonResponseJsonSchema) as any).properties).sort()
		);
	});
});
