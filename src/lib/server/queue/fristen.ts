/**
 * Die Fristen der Auslesung — und die Ordnung, in der sie stehen MÜSSEN.
 *
 *   OCR-Schritt  +  Erzeugungsdauer der Antwort  <  Zeitlimit-Obergrenze  <  Auftragsverfall
 *
 * Warum das keine Geschmacksfrage ist: Läuft pg-bosses Verfallsfrist ab, WÄHREND die
 * HTTP-Anfrage noch unterwegs ist, gilt der Auftrag als gescheitert und wird erneut
 * gestartet — der zweite Versuch läuft dann gleichzeitig zum ersten. Der Mac mini
 * verkraftet nach Messung seines Betreibers zwei bis drei gleichzeitige Anfragen und
 * antwortet danach mit HTTP 503. Eine zu kurze Verfallsfrist löst also genau die Last
 * aus, an der sie dann scheitert — eine Lawine, die wir uns selbst bauen.
 *
 * Auslegungsfall (2026-09-15): ein Bon mit 60 Positionen ergibt rund 6860 Ausgabe-Token;
 * bei gemessenen 30 Token/s sind das rund 229 s Erzeugung plus rund 14 s Prefill,
 * zusammen etwa 245 s. Das Zeitlimit muss darüber liegen, der Auftragsverfall darüber.
 */
export const AUFTRAG_VERFAELLT_SEKUNDEN = 600;

/**
 * Wie viel vom Auftragsbudget der OCR-Schritt hoechstens verbrauchen darf.
 *
 * Etappe 3 (PaddleOCR): bis dahin war OCR ein Tesseract-Aufruf von rund einer Sekunde
 * und fiel gegen die Modellzeit nicht ins Gewicht. PaddleOCR braucht gemessen 3,7 bis
 * 15,6 s und hat ein Zeitlimit von 60 s. Damit ist der OCR-Schritt zum ersten Mal ein
 * Posten, der in dieser Rechnung auftaucht — er laeuft VOR dem Modellaufruf, seine
 * Dauer kommt also obendrauf und nicht statt.
 *
 * Diese Zahl ist das BUDGET, nicht das Limit einer bestimmten Engine: jede Engine muss
 * hineinpassen, und der Test in `fristen.test.ts` haelt das fest. Sonst waere die
 * Summe genau die Groesse, die niemand prueft — und ein spaeter angehobenes
 * Engine-Zeitlimit risse die Ordnung lautlos ein.
 */
export const MAX_OCR_ZEITLIMIT_MS = 60_000;

/**
 * Obergrenze für EXTRACTION_TIMEOUT_MS. Eine volle Minute Sicherheitsabstand unter dem
 * Auftragsverfall, und darüber hinaus das OCR-Budget: das Zeitlimit muss zuverlässig
 * ZUERST greifen, damit ein hängender Anbieter als solcher erkannt wird, statt als
 * verfallener Auftrag wieder anzulaufen.
 *
 *   600 s Verfall  −  60 s Abstand  −  60 s OCR  =  480 s
 */
export const MAX_ZEITLIMIT_MS =
	(AUFTRAG_VERFAELLT_SEKUNDEN - 60) * 1000 - MAX_OCR_ZEITLIMIT_MS;
