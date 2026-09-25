import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { households } from '$lib/server/db/schema';
import { zaehlerLaden } from '$lib/server/bons/liste';
import type { LayoutServerLoad } from './$types';

/**
 * Was das Geruest auf jeder Seite braucht: wer angemeldet ist, wie der Haushalt heisst,
 * und wie viele Bons auf einen Menschen warten (der Zaehler an "Posteingang").
 */
export const load: LayoutServerLoad = async ({ locals }) => {
	if (!locals.user) return { user: null, haushalt: null, zaehler: { brauchtDich: 0 } };
	const [[haushalt], zaehler] = await Promise.all([
		db.select({ name: households.name }).from(households).where(eq(households.id, locals.user.householdId)),
		zaehlerLaden(db, locals.zugriff!)
	]);
	return {
		user: locals.user,
		haushalt: haushalt?.name ?? 'Haushalt',
		zaehler: { brauchtDich: zaehler.brauchtDich }
	};
};
