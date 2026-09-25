import { type AufnahmeErgebnis } from './ingest';

/**
 * Erfolg wird als Reaktion (✅) auf das Bild gemeldet, nicht als Text — unaufdringlich
 * und eindeutig dem Bild zuzuordnen. Jeder andere Ausgang bekommt einen Text, weil
 * eine Reaktion im Fehlerfall zu leicht übersehen wird und der Nutzer dann wissen
 * muss, was zu tun ist.
 *
 * `alarm` bedeutet zusätzlich eine Meldung im Raum „Server Alarme": nur für das, was
 * der Nutzer nicht selbst beheben kann.
 */
/**
 * Dieselbe Bestätigung für 'aufgenommen' UND (seit M4, Korrekturrunde 3)
 * 'schon_bekannt' — siehe dort für die Begründung der Ruling-Umkehr.
 */
const BESTAETIGUNGSTEXT = '✅ Bon angekommen, wird ausgelesen.';

export function antwortFuer(ergebnis: AufnahmeErgebnis): { text: string | null; alarm: boolean } {
	switch (ergebnis.art) {
		case 'aufgenommen':
			// Als TEXT, nicht als Reaktion. Eine Reaktion hängt an dem Ereignis, das
			// sie annotiert — und genau dieses Ereignis löscht der Bot unmittelbar
			// danach (E6, das Medium darf nicht doppelt liegen). Element zeigt eine
			// Reaktion auf ein gelöschtes Ereignis nicht mehr an: der Nutzer sah im
			// ERFOLGSFALL nichts, während sein Foto verschwand — und die naheliegende
			// Antwort darauf ist, den Bon erneut zu schicken, was mit neuer
			// Ereignis-ID einen Doppel-Bon erzeugt.
			// Am 2026-09-15 im echten Betrieb aufgetreten: die Logs zeigen `m.reaction`
			// und unmittelbar danach `m.room.redaction`, beide vom Bot. Zwei bewusste
			// Entscheidungen des Entwurfs widersprachen sich, und jede war für sich
			// geprüft und korrekt.
			return { text: BESTAETIGUNGSTEXT, alarm: false };
		case 'aufgenommen_zu_klein':
			// Entwurf E4: der Bon wird TROTZDEM gespeichert und ausgelesen — nichts wird
			// weggeworfen —, aber der Betreiber kann einem Bild nicht ansehen, dass
			// Element es kaputtkomprimiert hat. Der konkrete Ausweg (Datei-Symbol statt
			// Galerie) ist der Kern der Meldung, nicht nur die blosse Warnung.
			return {
				text:
					`⚠️ Bon angekommen, wird trotzdem ausgelesen. Das Bild ist aber nur ${ergebnis.breite}px breit — ` +
					'die Texterkennung liest bei so kleinen Bildern oft gar nichts. Schick es zur Sicherheit ' +
					'nochmal über das Datei-Symbol statt über die Galerie, dann komprimiert Element nicht.',
				alarm: false
			};
		case 'schon_bekannt':
			// M4 (Korrekturrunde 3, Ruling-Umkehr): stand vorher auf `text: null` —
			// richtig für den REGELFALL (der Nutzer hat diesen Bon beim ersten Mal
			// schon bestätigt bekommen, ein zweiter Hinweis auf dasselbe wiederholt
			// zugestellte Ereignis wäre Lärm ohne Aussage). Falsch für den Fall, in
			// dem der ERSTE Durchlauf nach `legeBonAn` abgebrochen ist, BEVOR die
			// Antwort rausging (die Fenster aus M1: SIGKILL beim Beenden; und W5:
			// das Senden der Bestätigung selbst scheitert) — dann bekam der Nutzer
			// beim ersten Mal nichts, und beim erneut zugestellten Ereignis (Matrix
			// liefert nach einem Neustart / ohne quittierten Sync-Token dasselbe
			// Ereignis nochmal) bisher wieder nichts. Zwei Durchläufe, keine einzige
			// Rückmeldung, während der Bon längst existiert.
			// Lärm ist der billigere Fehler: eine doppelte Bestätigung auf denselben
			// Bon ist harmlos (derselbe Text, dieselbe Ereignis-ID im Chat sichtbar);
			// Schweigen nach einem abgebrochenen Durchlauf ist ein echter Verlust an
			// Vertrauen in die Anzeige.
			return { text: BESTAETIGUNGSTEXT, alarm: false };
		case 'nicht_gekoppelt':
			return {
				text: 'Ich kenne dich nicht. Hol dir einen Kopplungscode in der App unter Einstellungen und schick ihn mir.',
				alarm: false
			};
		case 'zu_gross':
			return {
				text: `Das Bild ist zu gross (${mb(ergebnis.bytes)} MB, erlaubt sind ${mb(ergebnis.grenze)} MB). Schick es bitte kleiner.`,
				alarm: false
			};
		case 'kein_bild':
			return {
				text: 'Damit kann ich nichts anfangen — das sieht nicht nach einem lesbaren Bild aus. Es ist kein Bon entstanden.',
				alarm: false
			};
		case 'nicht_eingereiht':
			// Entscheidend: NICHT zum erneuten Schicken auffordern. Der Bon ist da;
			// ein zweites Foto erzeugte einen Doppel-Bon.
			//
			// W3 (Korrekturrunde 2): "Er steht im Posteingang als fehlgeschlagen" war
			// eine Zusicherung, die `ingest.ts` nicht geben kann — das Markieren als
			// 'failed' ist selbst nur best-effort (`.catch(...)` dort) und kann an
			// derselben Störung scheitern, die schon das Einreihen verhindert hat. Der
			// Bon bliebe dann auf 'pending' stehen, während der Text 'fehlgeschlagen'
			// behauptet — der Nutzer sucht nach dem falschen Wort und findet den Bon
			// nicht. Der Text hier behauptet nur noch, was in JEDEM Fall stimmt: der Bon
			// ist da, das Auslesen läuft nicht von selbst an.
			return {
				text: 'Der Bon ist angekommen, aber das Auslesen ist nicht angelaufen. Schau bitte im Posteingang nach, statt das Foto erneut zu schicken.',
				alarm: true
			};
		case 'fehler':
			// W1 (Korrekturrunde 2): "Der Bon wurde nicht gespeichert" war eine
			// Behauptung, die `ingest.ts` an jeder Stelle widerlegt, die zu 'fehler'
			// führt — dort heisst der Kommentar ausdrücklich "wir wissen es gerade
			// nicht" (Idempotenzprüfung, Zugangskontrolle, Bild ablegen, Bon anlegen
			// können alle NACH einem bereits committeten Bon scheitern, wenn nur die
			// Antwort an den Client verlorengeht). Wer glaubt, nichts sei angekommen,
			// schickt das Foto erneut — mit neuer Ereignis-ID, also einem Doppel-Bon.
			// Der Text darf daher nichts über den Verbleib behaupten und NICHT zum
			// erneuten Schicken auffordern; er verweist stattdessen auf den
			// Posteingang, wo der Nutzer den wahren Stand sieht. Der technische Grund
			// geht ins Log und in den Alarm, nicht an den Nutzer: er kann Endpunkte,
			// Pfade und Konfiguration nennen.
			return {
				text: 'Bei mir ist etwas schiefgegangen. Ich weiss gerade nicht, ob der Bon angekommen ist — schau bitte erst im Posteingang nach, bevor du ihn noch einmal schickst.',
				alarm: true
			};
	}
}

const mb = (bytes: number) => Math.round(bytes / (1024 * 1024));
