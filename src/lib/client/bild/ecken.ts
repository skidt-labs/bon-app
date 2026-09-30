/**
 * Den Bon im Foto finden (Entwurf 2026-09-27-zuschneiden-drehen): Graubild, Schwelle nach
 * Otsu, groesste helle zusammenhaengende Flaeche, Ecken als Extrempunkte von x+y und x−y.
 * Schlank und ohne Bibliothek (Entscheidung 30.09.2026) — am besten auf dunklem Grund.
 * Faellt die Flaeche zu klein oder fast bildfuellend aus, gibt es keine Aussage (null):
 * dann zeigt der Bildschirm das ganze Foto, statt eine absurde Ecke zu raten.
 *
 * Rein; aufgerufen auf einem verkleinerten Bild (lange Seite ≤ 320 px).
 */
import type { Quad } from '$lib/client/crop';

const MIN_ANTEIL = 0.2;
const MAX_ANTEIL = 0.97;
/**
 * Pruefung 30.09.2026: die Flaechenregel allein meldete falsche Ecken als „erkannt" — ein
 * weisser Tisch verschmilzt mit dem Bon, eine Hand oder ein zweiter Zettel haengt daran. Zwei
 * Proben mehr: die Flaeche darf hoechstens zwei Bildraender beruehren (ein langer Bon geht
 * oben und unten hinaus, aber nicht rundum), und sie muss ihr Viereck fast genau ausfuellen —
 * nicht weniger (Zettel daneben verschiebt eine Ecke) und nicht mehr (Arm daran). Gemessen
 * mit gefuellten Loechern, sonst zaehlte jede Textzeile als Luecke.
 */
const MAX_RAENDER = 2;
const MIN_FUELLGRAD = 0.95;
/** Und nicht darueber hinaus: ein Arm am Bon aendert die Ecken nicht, vergroessert aber die Flaeche. */
const MAX_FUELLGRAD = 1.05;

/** Flaeche eines Vierecks (Gausssche Trapezformel). */
function viereckFlaeche(q: Quad): number {
	let a = 0;
	for (let i = 0; i < 4; i++) {
		const p = q[i];
		const n = q[(i + 1) % 4];
		a += p.x * n.y - n.x * p.y;
	}
	return Math.abs(a) / 2;
}

/** Pixel der Flaeche samt ihrer Loecher: alles, was vom Bildrand aus nicht erreichbar ist. */
function gefuellteGroesse(marke: Int32Array, flaeche: number, breite: number, hoehe: number): number {
	const n = breite * hoehe;
	const draussen = new Uint8Array(n);
	const schlange = new Int32Array(n);
	let ende = 0;
	const rein = (i: number) => {
		if (draussen[i] || marke[i] === flaeche) return;
		draussen[i] = 1;
		schlange[ende++] = i;
	};
	for (let x = 0; x < breite; x++) {
		rein(x);
		rein((hoehe - 1) * breite + x);
	}
	for (let y = 0; y < hoehe; y++) {
		rein(y * breite);
		rein(y * breite + breite - 1);
	}
	for (let kopf = 0; kopf < ende; kopf++) {
		const i = schlange[kopf];
		const x = i % breite;
		if (x > 0) rein(i - 1);
		if (x < breite - 1) rein(i + 1);
		if (i >= breite) rein(i - breite);
		if (i + breite < n) rein(i + breite);
	}
	return n - ende;
}

export function graubild(rgba: Uint8ClampedArray, breite: number, hoehe: number): Uint8Array {
	const g = new Uint8Array(breite * hoehe);
	for (let i = 0; i < g.length; i++) {
		const o = i * 4;
		g[i] = Math.round(0.299 * rgba[o] + 0.587 * rgba[o + 1] + 0.114 * rgba[o + 2]);
	}
	return g;
}

/** Schwelle nach Otsu: helle Pixel sind die mit Wert > Schwelle. */
export function otsu(grau: Uint8Array): number {
	const hist = new Array<number>(256).fill(0);
	for (const v of grau) hist[v]++;
	const gesamt = grau.length;
	let summe = 0;
	for (let i = 0; i < 256; i++) summe += i * hist[i];
	let summeHinten = 0;
	let gewichtHinten = 0;
	let beste = 0;
	let schwelle = 0;
	for (let t = 0; t < 256; t++) {
		gewichtHinten += hist[t];
		if (gewichtHinten === 0) continue;
		const gewichtVorn = gesamt - gewichtHinten;
		if (gewichtVorn === 0) break;
		summeHinten += t * hist[t];
		const mHinten = summeHinten / gewichtHinten;
		const mVorn = (summe - summeHinten) / gewichtVorn;
		const zwischen = gewichtHinten * gewichtVorn * (mHinten - mVorn) ** 2;
		if (zwischen > beste) {
			beste = zwischen;
			schwelle = t;
		}
	}
	return schwelle;
}

export function findeBon(grau: Uint8Array, breite: number, hoehe: number): Quad | null {
	const n = breite * hoehe;
	const t = otsu(grau);
	const marke = new Int32Array(n); // 0 = unbesucht, -1 = dunkel, k = Flaeche k
	const warteschlange = new Int32Array(n);
	let besteFlaeche = 0;
	let besteGroesse = 0;
	let naechste = 1;
	for (let start = 0; start < n; start++) {
		if (marke[start] !== 0) continue;
		if (grau[start] <= t) {
			marke[start] = -1;
			continue;
		}
		const k = naechste++;
		let kopf = 0;
		let ende = 0;
		warteschlange[ende++] = start;
		marke[start] = k;
		while (kopf < ende) {
			const i = warteschlange[kopf++];
			const x = i % breite;
			const nachbarn = [x > 0 ? i - 1 : -1, x < breite - 1 ? i + 1 : -1, i - breite, i + breite];
			for (const j of nachbarn) {
				if (j < 0 || j >= n || marke[j] !== 0) continue;
				if (grau[j] <= t) {
					marke[j] = -1;
					continue;
				}
				marke[j] = k;
				warteschlange[ende++] = j;
			}
		}
		if (ende > besteGroesse) {
			besteGroesse = ende;
			besteFlaeche = k;
		}
	}
	if (besteGroesse < MIN_ANTEIL * n || besteGroesse > MAX_ANTEIL * n) return null;

	let ol = { w: Infinity, x: 0, y: 0 };
	let ur = { w: -Infinity, x: 0, y: 0 };
	let or = { w: -Infinity, x: 0, y: 0 };
	let ul = { w: Infinity, x: 0, y: 0 };
	for (let i = 0; i < n; i++) {
		if (marke[i] !== besteFlaeche) continue;
		const x = (i % breite) + 0.5;
		const y = Math.floor(i / breite) + 0.5;
		if (x + y < ol.w) ol = { w: x + y, x, y };
		if (x + y > ur.w) ur = { w: x + y, x, y };
		if (x - y > or.w) or = { w: x - y, x, y };
		if (x - y < ul.w) ul = { w: x - y, x, y };
	}
	const viereck: Quad = [
		{ x: ol.x, y: ol.y },
		{ x: or.x, y: or.y },
		{ x: ur.x, y: ur.y },
		{ x: ul.x, y: ul.y }
	];

	let oben = false;
	let unten = false;
	let links = false;
	let rechts = false;
	for (let x = 0; x < breite; x++) {
		if (marke[x] === besteFlaeche) oben = true;
		if (marke[(hoehe - 1) * breite + x] === besteFlaeche) unten = true;
	}
	for (let y = 0; y < hoehe; y++) {
		if (marke[y * breite] === besteFlaeche) links = true;
		if (marke[y * breite + breite - 1] === besteFlaeche) rechts = true;
	}
	if ([oben, unten, links, rechts].filter(Boolean).length > MAX_RAENDER) return null;

	const flaeche = viereckFlaeche(viereck);
	if (flaeche === 0) return null;
	const fuellgrad = gefuellteGroesse(marke, besteFlaeche, breite, hoehe) / flaeche;
	if (fuellgrad < MIN_FUELLGRAD || fuellgrad > MAX_FUELLGRAD) return null;
	return viereck;
}
