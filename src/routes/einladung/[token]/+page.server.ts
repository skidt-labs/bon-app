import { redirect, error, fail } from '@sveltejs/kit';
import {
	einladungPruefen,
	einladungEinloesen,
	EINLADUNG_TOKEN_COOKIE,
	EINLADUNG_COOKIE_TTL_S
} from '$lib/server/haushalt/einladungen';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals, cookies }) => {
	// Erst pruefen, DANN ueber die Anmeldung entscheiden: ein kaputter oder abgelaufener
	// Link soll sofort als solcher scheitern, statt einen nicht angemeldeten Menschen
	// erst durch die ganze Anmeldung zu schicken und ihn danach zu enttaeuschen.
	const info = await einladungPruefen(params.token);
	if (!info) error(404, 'Diese Einladung ist ungueltig oder abgelaufen.');

	if (!locals.user) {
		// Der Token muss den Umweg ueber die Anmeldestelle ueberleben — auth/callback
		// liest dieses Cookie nach dem Login wieder aus und leitet zurueck hierher.
		cookies.set(EINLADUNG_TOKEN_COOKIE, params.token, {
			path: '/',
			httpOnly: true,
			secure: true,
			sameSite: 'lax',
			maxAge: EINLADUNG_COOKIE_TTL_S
		});
		redirect(302, '/auth/login');
	}

	// Ein Rest von einer frueheren, abgebrochenen Einladung waere hier nur noch
	// Verwirrungspotential fuer eine spaetere, unabhaengige Anmeldung.
	cookies.delete(EINLADUNG_TOKEN_COOKIE, { path: '/' });

	return { haushaltsname: info.haushaltsname, rolle: info.rolle };
};

export const actions: Actions = {
	default: async ({ params, locals }) => {
		if (!locals.user) redirect(302, '/auth/login');
		const ergebnis = await einladungEinloesen(params.token, locals.user.id);
		if (ergebnis !== 'ok') return fail(400, { ergebnis });
		redirect(303, '/settings/household');
	}
};
