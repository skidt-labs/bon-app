/**
 * Erzeugt den Bericht aus bereits gemessenen Werten neu — ohne eine einzige Anfrage.
 *
 *   npx vite-node scripts/ocr-vergleich-bericht.ts messung/ocr-vergleich.json
 *
 * Gibt es, weil eine Messung teuer ist (18 Modellaufrufe, rund 25 Minuten) und die
 * Darstellung billig. Beim ersten Lauf ging die ganze Messung verloren, weil das
 * Schreiben am Ende scheiterte; seitdem liegen die Rohwerte daneben, und dieser Lauf
 * macht aus ihnen einen neuen Bericht, wenn sich an der Darstellung etwas aendert.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { bericht, beanstandungCode } from '../src/lib/server/ocr/vergleich';
import type { Messpunkt } from '../src/lib/server/ocr/vergleich';

const quelle = process.argv[2];
if (!quelle) throw new Error('Pfad zur JSON-Datei mit den Messwerten angeben.');

const punkte = (JSON.parse(readFileSync(quelle, 'utf8')) as Messpunkt[]).map((p) => ({
	...p,
	modell:
		p.modell?.status === 'gelesen'
			? { ...p.modell, beanstandungen: p.modell.beanstandungen.map(beanstandungCode) }
			: p.modell
}));

const ziel = quelle.replace(/\.json$/, '') + '.md';
writeFileSync(quelle, JSON.stringify(punkte, null, 2) + '\n', 'utf8');
writeFileSync(
	ziel,
	bericht(punkte, {
		datum: process.env.VERGLEICH_DATUM ?? new Date().toISOString().slice(0, 10),
		modell: process.env.EXTRACTION_MODEL ?? 'mlx-community/Qwen3.5-9B-MLX-4bit'
	}) + '\n',
	'utf8'
);
console.log(`Bericht neu erzeugt: ${ziel} (${punkte.length} Messpunkte)`);
