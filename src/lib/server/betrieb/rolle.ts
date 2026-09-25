import { env } from '$env/dynamic/private';
import type { SessionUser } from '$lib/server/auth/session';

/**
 * Wer die Instanz betreibt.
 *
 * ==================== DIE REGEL, DIE ALLES ANDERE BESTIMMT ====================
 * Der Eigentuemer VERWALTET. Er sieht nicht hinein.
 *
 * Diese Funktion darf in `zugriff/sichtbar.ts` NIE vorkommen, und keine Abfrage auf
 * Bons, Positionen, Betraege oder Toepfe darf an ihr haengen. Ein Waechter haelt das
 * fest (betrieb/grenze.lint.test.ts) — aus demselben Grund, aus dem `k.rolle` dort
 * nicht vorkommen darf: der ganze Berechtigungsentwurf steht auf dem Satz „ein
 * Verwalter sieht keine privaten Daten seiner Mitglieder", und ein Betreiber mit
 * Dateneinsicht macht ihn zu einer Beschriftung ohne Wirkung.
 *
 * Dass ein Betreiber ohnehin an die Datenbank kommt, aendert daran nichts. Der
 * Unterschied ist, ob die ANWENDUNG einen bequemen Weg dafuer anbietet.
 * ==============================================================================
 *
 * Die Rolle kommt aus einer Umgebungsvariablen, nicht aus einer Datenbankspalte: wer
 * den Server betreibt, hat Zugriff auf die `.env`; wer ihn nicht betreibt, kann die
 * Rolle auch mit Schreibzugriff auf die Anwendungstabellen nicht an sich reissen.
 *
 * Verglichen wird ueber `oidc_sub`, nicht ueber die Mailadresse — die kann sich aendern,
 * der `sub` nicht.
 *
 * Nicht gesetzt = es gibt keinen Eigentuemer. Das ist ein gueltiger Zustand: eine
 * Instanz fuer einen einzigen Haushalt braucht keinen.
 */
export function istBetreiber(user: { oidcSub?: string | null } | null): boolean {
	const erwartet = env.SUPERUSER_OIDC_SUB?.trim();
	if (!erwartet) return false;
	return !!user?.oidcSub && user.oidcSub === erwartet;
}

/** Fuer Aufrufer, die nur die Sitzung haben. */
export function istBetreiberSitzung(user: SessionUser | null): boolean {
	return istBetreiber(user ? { oidcSub: user.oidcSub } : null);
}
