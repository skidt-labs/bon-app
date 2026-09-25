import { nurBetreiber } from '$lib/server/betrieb/zugang';
import { protokollLesen } from '$lib/server/betrieb/protokoll';
import type { PageServerLoad } from './$types';

/** Nur lesen. Es gibt bewusst keine Action — Eintraege werden weder geaendert noch geloescht. */
export const load: PageServerLoad = async ({ locals }) => {
	nurBetreiber(locals);
	return { eintraege: await protokollLesen(200) };
};
