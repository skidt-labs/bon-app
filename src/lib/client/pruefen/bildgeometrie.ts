/**
 * Die Rechnung hinter dem Bildbetrachter der Pruefansicht: wo sitzt ein Rahmen, wohin
 * muss die Ansicht springen, welche Zeile liegt unter dem Zeiger.
 *
 * Rein und ohne DOM, damit sie sich ohne Browser pruefen laesst — die Suite hat keine
 * Komponententests, und das bleibt so. Die Komponente (Bonbild.svelte) misst nur ihr
 * Sichtfenster und ruft hier an.
 *
 * Eine Festlegung zieht sich durch alles: `zoom` ist KEIN absoluter Massstab, sondern
 * ein Vielfaches der eingepassten Breite. zoom = 1 heisst „der Bon fuellt die Spalte".
 * Das ist der Ruhezustand, in dem man einen Bon liest; alles andere waere von der
 * Pixelbreite des jeweiligen Fotos abhaengig, und dieselbe Stufe saehe bei jedem Bon
 * anders aus.
 */
export type Rahmen = { x: number; y: number; breite: number; hoehe: number };
export type Sichtfeld = { breite: number; hoehe: number };

export const ZOOM_STUFEN = [0.25, 0.4, 0.6, 0.8, 1, 1.3, 1.7, 2.2, 3] as const;

export function rahmenAus(box: [number, number, number, number]): Rahmen {
	return { x: box[0], y: box[1], breite: box[2], hoehe: box[3] };
}

/**
 * Pixel des Originalbildes in Anteile (0..1). Die Rahmen sitzen damit richtig, egal wie
 * gross das Bild dargestellt wird — die Komponente legt sie als prozentuale Kaesten
 * darueber und muss beim Zoomen nichts nachrechnen.
 */
export function alsAnteil(r: Rahmen, bild: Sichtfeld): Rahmen {
	if (bild.breite <= 0 || bild.hoehe <= 0) return { x: 0, y: 0, breite: 0, hoehe: 0 };
	return {
		x: r.x / bild.breite,
		y: r.y / bild.hoehe,
		breite: r.breite / bild.breite,
		hoehe: r.hoehe / bild.hoehe
	};
}

/**
 * Wohin die Ansicht scrollen muss, damit `r` mittig im Sichtfenster steht.
 *
 * Mittig, nicht am oberen Rand: beim Pruefen sind die Zeilen darueber und darunter die
 * halbe Information (steht der Preis eine Zeile tiefer? gehoert der Rabatt dazu?). An
 * den Raendern wird abgeschnitten, damit das Bild nicht halb im Leeren steht.
 */
export function ansichtAufRahmen(
	r: Rahmen,
	bild: Sichtfeld,
	sicht: Sichtfeld,
	zoom: number
): { links: number; oben: number } {
	if (bild.breite <= 0 || bild.hoehe <= 0) return { links: 0, oben: 0 };
	// Das Bild wird auf die Sichtbreite eingepasst und dann gezoomt.
	const massstab = (sicht.breite / bild.breite) * zoom;
	const grenze = (wert: number, gesamt: number, fenster: number) =>
		Math.max(0, Math.min(wert, gesamt - fenster));
	return {
		links: grenze(
			(r.x + r.breite / 2) * massstab - sicht.breite / 2,
			bild.breite * massstab,
			sicht.breite
		),
		oben: grenze(
			(r.y + r.hoehe / 2) * massstab - sicht.hoehe / 2,
			bild.hoehe * massstab,
			sicht.hoehe
		)
	};
}

/**
 * Welche Zeile liegt unter dem Punkt (in Bildpixeln)? `null`, wenn keine — zwischen den
 * Zeilen ist kein Treffer, und ein Klick daneben darf nicht die naechstbeste Zeile
 * waehlen. Ueberlappen zwei Rahmen, gewinnt der kleinere: er ist der genauere Treffer.
 */
export function rahmenUnterPunkt(
	zeilen: { box: [number, number, number, number] }[],
	punkt: { x: number; y: number }
): number | null {
	let treffer: number | null = null;
	let kleinste = Infinity;
	for (let i = 0; i < zeilen.length; i++) {
		const r = rahmenAus(zeilen[i].box);
		const drin =
			punkt.x >= r.x && punkt.x <= r.x + r.breite && punkt.y >= r.y && punkt.y <= r.y + r.hoehe;
		if (!drin) continue;
		const flaeche = r.breite * r.hoehe;
		if (flaeche < kleinste) {
			kleinste = flaeche;
			treffer = i;
		}
	}
	return treffer;
}

export function naechsteZoomStufe(aktuell: number, richtung: 1 | -1): number {
	if (richtung === 1) {
		return ZOOM_STUFEN.find((s) => s > aktuell + 1e-9) ?? ZOOM_STUFEN[ZOOM_STUFEN.length - 1];
	}
	return [...ZOOM_STUFEN].reverse().find((s) => s < aktuell - 1e-9) ?? ZOOM_STUFEN[0];
}
