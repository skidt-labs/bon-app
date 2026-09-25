import { redirect, fail } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { matrixBotState } from '$lib/server/db/schema';
import { verknuepfungFuerNutzer, verknuepfungLoesen } from '$lib/server/matrix/links';
import { codeAnlegen } from '$lib/server/matrix/pairing';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(302, '/auth/login');

	// Die Identität kommt aus der SITZUNG, nie aus der URL. Ein Parameter an dieser
	// Stelle wäre kein Anzeigefehler, sondern liesse jemanden einen Kopplungscode für
	// ein fremdes Konto erzeugen — und darüber Bons in dessen Haushalt einschleusen.
	const verknuepfung = await verknuepfungFuerNutzer(locals.user.id);
	const [stand] = await db.select().from(matrixBotState).where(eq(matrixBotState.id, 1));

	return {
		verknuepfung,
		// null heisst „noch nie gelaufen" und wird in der Ansicht auch so benannt, nicht
		// als Zeitstempel von 1970. Ein toter Bot ist der stille Totalausfall dieses
		// Wegs: Bons wandern ins Leere, und es fällt erst bei der nächsten Anmeldung auf.
		botZuletztGesehen: stand?.lastSyncAt ?? null,
		// Wohin die Fotos gehen. null = nicht eingetragen; die Seite sagt dann
		// allgemein „an den Bon-Bot", statt eine Adresse zu erfinden.
		botAdresse: env.MATRIX_BOT_USER?.trim() || null
	};
};

export const actions: Actions = {
	code: async ({ locals }) => {
		if (!locals.user) return fail(401, { grund: 'Nicht angemeldet' });
		const { code, expiresAt } = await codeAnlegen(locals.user.id);
		// Der Klartext wird hier EINMAL ausgeliefert und nirgends gespeichert — weder
		// in der Sitzung noch im Log. Wer ihn hat, kann ein Matrix-Konto an dieses
		// App-Konto binden.
		return { code, expiresAt };
	},
	loesen: async ({ locals }) => {
		if (!locals.user) return fail(401, { grund: 'Nicht angemeldet' });
		await verknuepfungLoesen(db, locals.user.id);
		return { geloest: true };
	}
};
