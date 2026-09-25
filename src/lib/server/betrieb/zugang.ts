import { error, redirect } from '@sveltejs/kit';
import { istBetreiberSitzung } from './rolle';
import type { SessionUser } from '$lib/server/auth/session';

/**
 * Tuer zu allen Reitern von /betrieb. 404, nicht 403: ein 403 verriete, dass es die
 * Seite gibt (siehe Entwurf Betreiber-Rolle).
 */
export function nurBetreiber(locals: App.Locals): SessionUser {
	if (!locals.user) redirect(302, '/auth/login');
	if (!istBetreiberSitzung(locals.user)) error(404, 'Nicht gefunden');
	return locals.user;
}
