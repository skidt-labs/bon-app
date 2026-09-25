import { redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { startseiteLaden } from '$lib/server/dashboard/laden';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(302, '/auth/login');
	return startseiteLaden(db, locals.zugriff!);
};
