import { redirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	// Wer angemeldet ist, hat auf der Anmeldeseite nichts verloren.
	if (locals.user) redirect(302, '/');
	return {
		// Der Name des Anbieters gehoert in die Konfiguration, nicht in den Quelltext:
		// wer die App selbst betreibt, benutzt vielleicht Keycloak, Zitadel oder Google.
		anbieter: env.OIDC_ANBIETER || 'Single Sign-On',
		abgemeldet: url.searchParams.has('abgemeldet')
	};
};
