/**
 * Warum sich ein Bon gerade nicht aendern, bestaetigen oder neu lesen laesst — EIN Satz je
 * Status, fuer alle Endpunkte. Vorher hatte jeder Endpunkt seine eigene Weiche, und alles,
 * was nicht `doppelt` war, hiess „wird gerade ausgelesen" — auch ein Bon im Papierkorb.
 */
export function statusSperrText(status: string): string {
	switch (status) {
		case 'pending':
		case 'extracting':
			return 'Dieser Bon wird gerade gelesen.';
		case 'verworfen':
			return 'Dieser Bon liegt im Papierkorb.';
		case 'doppelt':
			// „wie heute" (2.2): gesperrt, weil Doppel. „Verworfen" meint seit 2.9 nur den Papierkorb.
			return 'Dieser Bon ist als Doppel markiert und lässt sich darum nicht bearbeiten.';
		case 'confirmed':
			return 'Dieser Bon ist bereits bestätigt.';
		default:
			// review/failed sperren nirgends — landet ein Endpunkt trotzdem hier, hat sich der
			// Bon zwischen Laden und Schreiben geaendert.
			return 'Dieser Bon hat sich gerade geändert. Bitte die Seite neu laden.';
	}
}
