import type { Handle } from '@sveltejs/kit';
import { validateSession, SESSION_COOKIE } from '$lib/server/auth/session';
import { kontextAus } from '$lib/server/zugriff/kontext';

export const handle: Handle = async ({ event, resolve }) => {
	const sessionId = event.cookies.get(SESSION_COOKIE);
	event.locals.user = sessionId ? await validateSession(sessionId) : null;
	event.locals.zugriff = event.locals.user ? kontextAus(event.locals.user) : null;
	return resolve(event);
};
