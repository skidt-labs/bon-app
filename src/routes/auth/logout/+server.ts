import { redirect } from '@sveltejs/kit';
import { deleteSession, SESSION_COOKIE } from '$lib/server/auth/session';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ cookies }) => {
	const id = cookies.get(SESSION_COOKIE);
	if (id) await deleteSession(id);
	cookies.delete(SESSION_COOKIE, { path: '/' });
	// Zurueck auf die Anmeldeseite, nicht auf '/'. Ueber '/' liefe der Mensch sofort
	// wieder in den Anbieter-Absprung und waere ohne Zutun neu angemeldet — das sah aus,
	// als taete der Abmelden-Knopf nichts. Der Parameter sorgt fuer die Bestaetigung.
	//
	// 303, nicht 302: nach einem POST sagt 303 dem Browser eindeutig, die Zielseite mit
	// GET zu holen. Bei 302 ist das historisch gewachsene Praxis, aber nicht vorgeschrieben.
	redirect(303, '/auth/login?abgemeldet');
};
