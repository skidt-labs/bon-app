/**
 * Was ein Import ODER Re-Export aus `$lib/server/db/schema` an VERBOTENEN
 * Tabellennamen mitbringt — in jeder Schreibweise, die eine Route dafuer waehlen koennte.
 *
 * Ausgelagert aus tor.lint.test.ts (Fix-Runde 1, Aufgabe 3): ein Waechter ohne eigenen
 * Test ist blind fuer seine eigenen Luecken.
 *
 * Fix-Runde 1 schloss Alias- und typreine Importe (`receipts as r`,
 * `import type { receipts }`). Fix-Runde 2 schliesst drei weitere Formen — eine
 * Namensliste allein reicht nicht, sobald der Weg zur Tabelle nicht ueber einen
 * benannten Import fuehrt:
 *
 * 1. Der Sternchen-Import — `import * as schema from '…/db/schema'` gefolgt von
 *    `schema.receipts`. KEIN Randfall: genau dieses Muster steht schon in
 *    `src/lib/server/db/index.ts` (`import * as schema from './schema'`) — die
 *    Vorlage liegt im Repo, wer in Eile eine Route baut, schaut sich mit guter Chance
 *    genau das ab.
 * 2. Der Re-Export — `export { receipts } from '…/db/schema'` (dieselbe Erkennung wie
 *    beim Import, nur mit `export`) und `export * from '…/db/schema'` (reicht
 *    zwangslaeufig auch die verbotenen Namen weiter, ohne dass sich einzeln sagen
 *    liesse, welche — zaehlt darum komplett als Verstoss).
 * 3. Das dynamische `import(...)` — destrukturiert
 *    (`const { receipts } = await import('…/db/schema')`), ueber einen
 *    Namespace-Alias (`const schema = await import('…/db/schema'); schema.receipts`)
 *    oder ganz ohne Zwischenvariable (`(await import('…/db/schema')).receipts`).
 *
 * Bewusste Grenze: erkannt wird `alias.name` als direkte Textfolge, keine weitere Ebene
 * Indirektion (z. B. `const { receipts } = schema;`, NACHDEM `schema` per
 * Sternchen-Import kam). Das ist ein Text-Scan, kein Typchecker.
 */
const VERBOTEN = ['receipts', 'receiptItems', 'budgets', 'budgetBetraege', 'budgetKategorien'];

// import { … } / import type { … } / export { … } / export type { … } aus dem Schema.
const BENANNT = /(?:import|export)\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]\$lib\/server\/db\/schema['"]/gs;

// export * from '…/db/schema' (optional mit `as ns`) — reicht ALLES weiter.
// Ohne g-Flag: dieser Regex wird nur mit .test() benutzt, ein globaler Regex wuerde
// sich ueber lastIndex zwischen Aufrufen zustandsbehaftet und damit falsch verhalten.
const STERNCHEN_REEXPORT = /export\s*\*\s*(?:as\s+\w+\s*)?from\s*['"]\$lib\/server\/db\/schema['"]/;

// import * as alias from '…/db/schema'
const STERNCHEN_IMPORT = /import\s*\*\s*as\s+(\w+)\s*from\s*['"]\$lib\/server\/db\/schema['"]/g;

// const { … } = await import('…/db/schema') — dynamischer, destrukturierter Import.
const DYNAMISCH_BENANNT =
	/(?:const|let|var)\s*\{([^}]*)\}\s*=\s*(?:await\s+)?import\(\s*['"]\$lib\/server\/db\/schema['"]\s*\)/gs;

// const alias = await import('…/db/schema') — dynamischer Namespace-Import.
const DYNAMISCH_STERNCHEN =
	/(?:const|let|var)\s+(\w+)\s*=\s*(?:await\s+)?import\(\s*['"]\$lib\/server\/db\/schema['"]\s*\)/g;

// (await import('…/db/schema')).receipts — direkter Zugriff ohne Zwischenvariable.
const DYNAMISCH_DIREKT =
	/\(?\s*(?:await\s+)?import\(\s*['"]\$lib\/server\/db\/schema['"]\s*\)\s*\)?\s*\.\s*(\w+)/g;

/**
 * Der exportierte Name hinter einem Spezifizierer. ES-Alias (`receipts as r`),
 * Destrukturierungs-Alias (`receipts: r`) und ein fuehrendes `type` zaehlen dafuer
 * nicht — nur der Name, der tatsaechlich aus dem Schema-Modul kommt.
 */
function exportierterName(spezifizierer: string): string {
	const ohneAlias = spezifizierer.trim().split(/\s+as\s+|\s*:\s*/)[0];
	return ohneAlias.replace(/^type\s+/, '').trim();
}

/** Sammelt Treffer aus einer Namensliste (`{ receipts, categories }` in jeder Form). */
function ausListe(quelltext: string, regex: RegExp, treffer: Set<string>) {
	for (const fund of quelltext.matchAll(regex)) {
		for (const spezifizierer of fund[1].split(',')) {
			const name = exportierterName(spezifizierer);
			if (VERBOTEN.includes(name)) treffer.add(name);
		}
	}
}

/**
 * Sammelt Treffer aus einem Alias (`import * as X` / `const X = await import(...)`) —
 * zaehlt nur, wenn der Alias tatsaechlich mit einem verbotenen Namen benutzt wird
 * (`X.receipts`), nicht schon durch den blossen Import.
 */
function ausAliasNutzung(quelltext: string, regex: RegExp, treffer: Set<string>) {
	for (const fund of quelltext.matchAll(regex)) {
		const nutzung = new RegExp(`\\b${fund[1]}\\.(\\w+)`, 'g');
		for (const n of quelltext.matchAll(nutzung)) {
			if (VERBOTEN.includes(n[1])) treffer.add(n[1]);
		}
	}
}

export function verbotenImporte(quelltext: string): string[] {
	const treffer = new Set<string>();
	ausListe(quelltext, BENANNT, treffer);
	ausListe(quelltext, DYNAMISCH_BENANNT, treffer);
	ausAliasNutzung(quelltext, STERNCHEN_IMPORT, treffer);
	ausAliasNutzung(quelltext, DYNAMISCH_STERNCHEN, treffer);
	for (const fund of quelltext.matchAll(DYNAMISCH_DIREKT)) {
		if (VERBOTEN.includes(fund[1])) treffer.add(fund[1]);
	}
	if (STERNCHEN_REEXPORT.test(quelltext)) for (const n of VERBOTEN) treffer.add(n);
	return [...treffer];
}
