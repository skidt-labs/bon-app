/**
 * Übersetzt die Fehlercodes aus RFC 6749 §4.1.2.1 in etwas, das ein Mensch lesen kann.
 *
 * Bewusst OHNE die mitgelieferte `error_description`: die steht in der Rückleitungs-URL
 * und lässt sich von jedem setzen, der einen Link baut. Fremder Text, den unsere eigene
 * Seite unter unserer eigenen Domain anzeigt, ist eine Einladung zum Phishing
 * ("Sitzung abgelaufen, Passwort bitte hier eingeben ..."). Der Rohwert geht ins
 * Serverlog, wo er hingehört und niemandem etwas vormacht.
 */
export function oidcFehlerMeldung(code: string): { status: number; text: string } {
	if (code === 'access_denied') {
		return {
			status: 403,
			text: 'Kein Zugriff auf die Bon-App. Dein Konto ist nicht dafür freigeschaltet.'
		};
	}
	if (code === 'login_required' || code === 'interaction_required') {
		return { status: 401, text: 'Anmeldung nötig. Bitte versuche es noch einmal.' };
	}
	// invalid_request, unauthorized_client, unsupported_response_type, server_error,
	// temporarily_unavailable und alles Unbekannte: Konfigurations- oder Serverfehler,
	// gegen die der Nutzer nichts ausrichten kann. Kein "versuch es nochmal" vortäuschen,
	// wo Wiederholen nachweislich nichts ändert — und keine Interna zeigen.
	return {
		status: 502,
		text: 'Die Anmeldung ist an der Anmeldestelle gescheitert. Das ist ein Fehler auf unserer Seite, nicht bei dir.'
	};
}
