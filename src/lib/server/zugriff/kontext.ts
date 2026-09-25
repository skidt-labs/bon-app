import type { SessionUser } from '$lib/server/auth/session';
import type { Rolle } from '$lib/server/haushalt/mitglieder';

export type Zugriffskontext = { haushaltId: string; nutzerId: string; rolle: Rolle };

export function kontextAus(user: SessionUser): Zugriffskontext {
	return { haushaltId: user.householdId, nutzerId: user.id, rolle: user.rolle };
}

/** Macht ueber das GETEILTE. Sagt nichts darueber, was jemand sieht. */
export function darfGeteiltesVerwalten(k: Zugriffskontext): boolean {
	return k.rolle === 'verwalter';
}

/**
 * Darf dieser Mensch diesen Topf aendern?
 *
 * Die Regel ist feiner als "nur der Verwalter": ein PRIVATER Topf gehoert seinem
 * Eigentuemer, und dort hat die Rolle nichts zu suchen — ein Mitglied muss seine eigenen
 * Toepfe verwalten koennen, sonst waeren private Budgets nur zum Anschauen da. Nur beim
 * GETEILTEN Topf greift die Rolle.
 *
 * Dass ueberhaupt nur der Eigentuemer einen privaten Topf in die Hand bekommt, sichert
 * schon `sichtbareToepfe` — wer ihn nicht sieht, kann ihn nicht laden. Diese Funktion
 * entscheidet die zweite Frage: was jemand damit TUN darf.
 */
export function darfTopfAendern(
	k: Zugriffskontext,
	topf: { sichtbarkeit: 'geteilt' | 'privat' }
): boolean {
	return topf.sichtbarkeit === 'privat' ? true : darfGeteiltesVerwalten(k);
}
