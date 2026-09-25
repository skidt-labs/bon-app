import type { OcrEngineName } from './anbieter';

/**
 * Der Vergleich zweier OCR-Engines (Etappe 4).
 *
 * Hier steht ABSICHTLICH keine Ein-/Ausgabe: kein Dateizugriff, kein Netz, keine
 * Datenbank. Nur die Rechnung von Messwerten zu Kennzahlen und die Darstellung als
 * Bericht. Der Grund ist derselbe wie ueberall in dieser Anbindung — eine Zahl, die
 * eine Entscheidung traegt, gehoert dorthin, wo ein Test sie nachrechnen kann. Die
 * Messung selbst macht `scripts/ocr-vergleich.ts`.
 *
 * WICHTIG fuer alles, was hier entsteht: der Bericht enthaelt **keinen Bontext**.
 * Weder Artikelnamen noch Haendler noch Betraege einzelner Zeilen. Er landet in `docs/`,
 * und `docs/` laeuft ins Backup und moeglicherweise in ein Repo. Kennzahlen und
 * Bon-Kennungen genuegen fuer jede Frage, die dieser Vergleich beantworten soll.
 */

/** Was bei EINEM Bon mit EINER Engine gemessen wurde. */
export type Messpunkt = {
	bonId: string;
	engine: OcrEngineName;
	/** Breite x Hoehe des gelesenen Bildes — die Groesse erklaert Laufzeitunterschiede. */
	bildBreite: number;
	bildHoehe: number;
	ocr:
		| { status: 'gelesen'; dauerMs: number; zeilen: number; zeichen: number; confidence: number | null }
		| { status: 'nichtsGefunden' | 'werkzeugKaputt'; dauerMs: number; grund?: string };
	/** Urteil des Tuerstehers. `null`, wenn es gar keinen Text zu beurteilen gab. */
	tuersteher: { brauchbar: boolean; anzahlBetraege: number; hatSummenzeile: boolean } | null;
	/** Ergebnis des Modellaufrufs. `null`, wenn er gar nicht stattfand. */
	modell:
		| { status: 'gelesen'; dauerMs: number; positionen: number; beanstandungen: string[] }
		| { status: 'gescheitert'; dauerMs: number; fehler: string }
		| null;
	/**
	 * Nur bei einem vom Betreiber BESTAETIGTEN Bon: der Abgleich gegen die Werte, die
	 * er von Hand geprueft hat. `null` heisst „fuer diesen Bon gibt es keine geprueften
	 * Werte" — ausdruecklich NICHT „stimmt nicht ueberein".
	 */
	gegenBestaetigt: {
		summeStimmt: boolean;
		positionenSoll: number;
		positionenIst: number;
		/** Anteil der bestaetigten Positionen, deren Betrag wiedergefunden wurde. */
		betraegeGetroffen: number;
	} | null;
};

export type EngineKennzahlen = {
	engine: OcrEngineName;
	bons: number;
	ocrGelesen: number;
	tuerstehreBestanden: number;
	modellGelesen: number;
	/** Bons, deren Positionen zur ausgewiesenen Endsumme passen. */
	summeStimmig: number;
	beanstandungenGesamt: number;
	ocrDauerMsMedian: number;
	modellDauerMsMedian: number;
	confidenceMittel: number | null;
	/** Nur ueber Bons mit geprueften Werten; `null`, wenn es keine gibt. */
	gegenBestaetigt: { bons: number; summeStimmt: number; betraegeGetroffenMittel: number } | null;
};

/**
 * Kuerzt eine Beanstandung auf einen Code.
 *
 * `checkPlausibility` liefert ohnehin Codes (`sum_mismatch` und Verwandte). Die
 * Meldungen des Anbieters sind dagegen ganze Saetze und tragen **Bontext** mit sich —
 * Artikelname und Betrag der Zeile, die er entfernt hat. In einem Bericht, der in
 * `docs/` liegt und ins Backup laeuft, hat das nichts verloren.
 *
 * Beim ersten Lauf ist genau das passiert: „Position 8 (\"Pfand\", Pfand 0,25 EUR …)"
 * stand im Bericht. Harmlos bei Pfand, nicht harmlos beim naechsten Bon. Fuer den
 * Vergleich zaehlt ohnehin nur, DASS der Anbieter korrigiert hat, nicht was.
 */
export function beanstandungCode(text: string): string {
	// Codes sind kleingeschrieben, ohne Leerzeichen und kurz — alles andere ist ein Satz.
	if (/^[a-z][a-z0-9_]*$/.test(text)) return text;
	return 'anbieter_korrektur';
}

export function median(werte: number[]): number {
	if (werte.length === 0) return 0;
	const s = [...werte].sort((a, b) => a - b);
	const m = Math.floor(s.length / 2);
	// Bei gerader Anzahl das Mittel der beiden mittleren — sonst haenge das Ergebnis
	// davon ab, ob zufaellig ein Bon mehr oder weniger gemessen wurde.
	return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function mittel(werte: number[]): number | null {
	if (werte.length === 0) return null;
	return werte.reduce((a, b) => a + b, 0) / werte.length;
}

export function kennzahlen(punkte: Messpunkt[], engine: OcrEngineName): EngineKennzahlen {
	const eigene = punkte.filter((p) => p.engine === engine);
	const gelesen = eigene.filter((p) => p.ocr.status === 'gelesen');
	const mitModell = eigene.filter((p) => p.modell?.status === 'gelesen');
	const bestaetigt = eigene.filter((p) => p.gegenBestaetigt !== null);

	return {
		engine,
		bons: eigene.length,
		ocrGelesen: gelesen.length,
		tuerstehreBestanden: eigene.filter((p) => p.tuersteher?.brauchbar === true).length,
		modellGelesen: mitModell.length,
		// Die wichtigste Zahl ohne geprueften Sollwert: passen die ausgelesenen
		// Positionen zur ausgewiesenen Endsumme? Das laesst sich pruefen, ohne dass
		// jemand den Bon von Hand nachgerechnet hat — der Bon widerspricht sich
		// entweder selbst oder nicht.
		summeStimmig: mitModell.filter(
			(p) => p.modell?.status === 'gelesen' && !p.modell.beanstandungen.includes('sum_mismatch')
		).length,
		beanstandungenGesamt: mitModell.reduce(
			(a, p) => a + (p.modell?.status === 'gelesen' ? p.modell.beanstandungen.length : 0),
			0
		),
		ocrDauerMsMedian: median(gelesen.map((p) => p.ocr.dauerMs)),
		modellDauerMsMedian: median(mitModell.map((p) => p.modell!.dauerMs)),
		confidenceMittel: mittel(
			gelesen
				.map((p) => (p.ocr.status === 'gelesen' ? p.ocr.confidence : null))
				.filter((c): c is number => c !== null)
		),
		gegenBestaetigt:
			bestaetigt.length === 0
				? null
				: {
						bons: bestaetigt.length,
						summeStimmt: bestaetigt.filter((p) => p.gegenBestaetigt!.summeStimmt).length,
						betraegeGetroffenMittel:
							mittel(bestaetigt.map((p) => p.gegenBestaetigt!.betraegeGetroffen)) ?? 0
					}
	};
}

function prozent(teil: number, ganz: number): string {
	return ganz === 0 ? '—' : `${teil}/${ganz}`;
}

function ms(n: number): string {
	return n === 0 ? '—' : `${(n / 1000).toFixed(1)} s`;
}

/**
 * Der Bericht. Markdown, damit er neben den anderen Unterlagen liegen kann.
 *
 * Er sagt AUSDRUECKLICH, worauf jede Zahl beruht. Eine Trefferquote gegen einen
 * geprueften Sollwert und eine Stimmigkeit gegen die eigene Endsumme sind zwei sehr
 * verschiedene Aussagen — nebeneinander in einer Tabelle sehen sie gleich aus, und
 * genau daraus entstehen spaeter falsche Schluesse.
 */
export function bericht(punkte: Messpunkt[], stand: { datum: string; modell: string }): string {
	const engines: OcrEngineName[] = ['tesseract', 'paddleocr'];
	const k = engines.map((e) => kennzahlen(punkte, e));
	const bonAnzahl = new Set(punkte.map((p) => p.bonId)).size;
	const mitSoll = k.find((x) => x.gegenBestaetigt !== null)?.gegenBestaetigt?.bons ?? 0;

	const zeilen: string[] = [];
	zeilen.push(`# OCR-Vergleich: Tesseract gegen PaddleOCR`);
	zeilen.push('');
	zeilen.push(
		`Gemessen am ${stand.datum} an ${bonAnzahl} echten Bons, beide Engines auf demselben ` +
			`Bild, danach beide durch dasselbe Modell (${stand.modell}) auf der Hardware des ` +
			`Betreibers. Kein Bontext in diesem Bericht — nur Kennzahlen.`
	);
	zeilen.push('');

	if (mitSoll === 0) {
		zeilen.push(
			`> **Es gibt keinen geprueften Sollwert.** Kein Bon im Bestand ist bestaetigt, also ` +
				`kann dieser Vergleich nicht sagen, welche Engine RICHTIGER liest — nur, welche ` +
				`weiter kommt und sich seltener selbst widerspricht. Sobald Bons bestaetigt sind, ` +
				`fuellt derselbe Lauf die Spalte "gegen geprueften Sollwert".`
		);
	} else {
		zeilen.push(
			`> **${mitSoll} von ${bonAnzahl} Bons haben gepruefte Sollwerte.** Nur fuer diese sagt ` +
				`der Vergleich etwas ueber RICHTIGKEIT; fuer die uebrigen nur ueber Fortkommen und ` +
				`innere Stimmigkeit.`
		);
	}
	zeilen.push('');
	zeilen.push('## Ohne Sollwert messbar');
	zeilen.push('');
	zeilen.push('| | ' + k.map((x) => x.engine).join(' | ') + ' |');
	zeilen.push('|---|' + k.map(() => '---').join('|') + '|');
	zeilen.push('| OCR gelesen | ' + k.map((x) => prozent(x.ocrGelesen, x.bons)).join(' | ') + ' |');
	zeilen.push(
		'| Tuersteher bestanden | ' + k.map((x) => prozent(x.tuerstehreBestanden, x.bons)).join(' | ') + ' |'
	);
	zeilen.push(
		'| Modell lieferte einen Bon | ' + k.map((x) => prozent(x.modellGelesen, x.bons)).join(' | ') + ' |'
	);
	zeilen.push(
		'| Positionen passen zur Endsumme | ' +
			k.map((x) => prozent(x.summeStimmig, x.modellGelesen)).join(' | ') +
			' |'
	);
	zeilen.push(
		'| Beanstandungen gesamt | ' + k.map((x) => String(x.beanstandungenGesamt)).join(' | ') + ' |'
	);
	zeilen.push('| OCR-Dauer (Median) | ' + k.map((x) => ms(x.ocrDauerMsMedian)).join(' | ') + ' |');
	zeilen.push('| Modell-Dauer (Median) | ' + k.map((x) => ms(x.modellDauerMsMedian)).join(' | ') + ' |');
	zeilen.push(
		'| Confidence (Mittel) | ' +
			k.map((x) => (x.confidenceMittel === null ? '—' : x.confidenceMittel.toFixed(1))).join(' | ') +
			' |'
	);
	zeilen.push('');

	if (mitSoll > 0) {
		zeilen.push('## Gegen geprueften Sollwert');
		zeilen.push('');
		zeilen.push('| | ' + k.map((x) => x.engine).join(' | ') + ' |');
		zeilen.push('|---|' + k.map(() => '---').join('|') + '|');
		zeilen.push(
			'| Endsumme richtig | ' +
				k
					.map((x) =>
						x.gegenBestaetigt ? prozent(x.gegenBestaetigt.summeStimmt, x.gegenBestaetigt.bons) : '—'
					)
					.join(' | ') +
				' |'
		);
		zeilen.push(
			'| Betraege wiedergefunden | ' +
				k
					.map((x) =>
						x.gegenBestaetigt
							? `${(x.gegenBestaetigt.betraegeGetroffenMittel * 100).toFixed(0)} %`
							: '—'
					)
					.join(' | ') +
				' |'
		);
		zeilen.push('');
	}

	zeilen.push('## Je Bon');
	zeilen.push('');
	zeilen.push('| Bon | Bild | Engine | OCR | Zeilen | Tuersteher | Modell | Positionen | Beanstandungen |');
	zeilen.push('|---|---|---|---|---|---|---|---|---|');
	for (const p of punkte) {
		const ocrText =
			p.ocr.status === 'gelesen' ? ms(p.ocr.dauerMs) : `**${p.ocr.status}**`;
		const zeilenZahl = p.ocr.status === 'gelesen' ? String(p.ocr.zeilen) : '—';
		const tuer = p.tuersteher === null ? '—' : p.tuersteher.brauchbar ? 'ja' : '**nein**';
		const modell =
			p.modell === null
				? '—'
				: p.modell.status === 'gelesen'
					? ms(p.modell.dauerMs)
					: `**gescheitert**`;
		const positionen = p.modell?.status === 'gelesen' ? String(p.modell.positionen) : '—';
		const beanstandungen =
			p.modell?.status === 'gelesen'
				? p.modell.beanstandungen.join(', ') || '—'
				: p.modell?.status === 'gescheitert'
					? p.modell.fehler.slice(0, 60)
					: '—';
		zeilen.push(
			`| ${p.bonId.slice(0, 8)} | ${p.bildBreite}x${p.bildHoehe} | ${p.engine} | ${ocrText} | ` +
				`${zeilenZahl} | ${tuer} | ${modell} | ${positionen} | ${beanstandungen} |`
		);
	}
	zeilen.push('');
	return zeilen.join('\n');
}
