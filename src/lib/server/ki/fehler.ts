/**
 * Fehler der KI-KONFIGURATION, nicht des Bons.
 *
 * Der Worker stuft sie als voruebergehend ein (siehe istVoruebergehenderFehler): der Bon
 * ist nicht schuld, und sobald der Betreiber die Einstellung repariert, laeuft er beim
 * naechsten Versuch durch. Erst wenn das Wiederholungsbudget erschoepft ist, wird er
 * markiert — wie bei einem Modell, das die ganze Nacht nicht erreichbar war.
 */
export class KiKonfigurationFehler extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = new.target.name;
	}
}

/** Ein Anbieter mit `weg = bild` soll laufen, aber EXTRACTION_BILDWEG_BESTAETIGT ist nicht `ja`. */
export class BildwegNichtFreigegeben extends KiKonfigurationFehler {}

/** Der gespeicherte Schluessel laesst sich nicht entschluesseln (SECRETS_KEY geaendert, Daten verfaelscht). */
export class KiSchluesselUnlesbar extends KiKonfigurationFehler {}
