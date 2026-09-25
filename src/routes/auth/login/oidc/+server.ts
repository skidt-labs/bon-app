import { redirect } from '@sveltejs/kit';
import { buildLoginUrl } from '$lib/server/auth/oidc';
import type { RequestHandler } from './$types';

/**
 * Der Absprung zum Identitaetsanbieter.
 *
 * Lag bis 18.09.2026 auf /auth/login selbst, weshalb es dort gar keine Seite gab: jeder
 * Aufruf sprang wortlos weiter. Nach dem Abmelden fuehrte das in einen Rundlauf — die
 * eigene Sitzung war geloescht, der Anbieter hatte seine aber noch und meldete sofort
 * wieder an. Von aussen sah das aus, als taete der Abmelden-Knopf nichts.
 *
 * Jetzt ist /auth/login eine Seite mit der Wahl, und dies hier ist einer der Wege.
 */
export const GET: RequestHandler = async ({ cookies }) => {
	const { url, codeVerifier, state } = await buildLoginUrl();
	const opts = { path: '/', httpOnly: true, secure: true, sameSite: 'lax' as const, maxAge: 600 };
	cookies.set('oidc_verifier', codeVerifier, opts);
	cookies.set('oidc_state', state, opts);
	redirect(302, url);
};
