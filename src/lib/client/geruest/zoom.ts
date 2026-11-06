/**
 * Die Leiste unten beim Zoomen mit zwei Fingern (Wunsch der Nutzerin, 06.11.2026:
 * „Die Leiste unten … sollte bestehen bleiben, unabhaengig davon, wenn man reinzoomt.“).
 *
 * `position: fixed` haengt am Layout-Viewport; beim Zoomen zeigt der Browser nur einen
 * Ausschnitt davon (visualViewport), und die Leiste rutscht aus dem Bild. Die Leiste
 * wird deshalb an den unteren Rand des sichtbaren Ausschnitts geschoben und um
 * 1/Zoom verkleinert, damit sie auf dem Schirm gleich gross bleibt. Dazu gehoert
 * `transform-origin: 0 100%` an der Leiste (links unten).
 *
 * Nur bei Zoom > 1,01: die Bildschirmtastatur verkleinert den sichtbaren Bereich ohne
 * Zoom — dann bleibt die Leiste, wo sie ist (sie springt nicht ueber die Tastatur), und
 * Rundungsrauschen knapp ueber 1 bewegt nichts.
 */
export function leistenTransform(
	vv: { offsetLeft: number; offsetTop: number; width: number; height: number; scale: number },
	layoutHoehe: number
): string | null {
	if (vv.scale <= 1.01) return null;
	const x = vv.offsetLeft;
	const y = vv.offsetTop + vv.height - layoutHoehe;
	return `translate(${x}px, ${y}px) scale(${1 / vv.scale})`;
}
