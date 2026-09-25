import { fail } from '@sveltejs/kit';
import { nurBetreiber } from '$lib/server/betrieb/zugang';
import { protokolliere } from '$lib/server/betrieb/protokoll';
import { db } from '$lib/server/db';
import {
	haushalteUebersicht,
	nutzerUebersicht,
	haushaltAnlegenMitEinladung,
	haushaltLoeschen,
	HaushaltNichtLeer,
	nutzerSperren,
	nutzerEntsperren,
	SelbstSperrung,
	selbstbedienungLesen,
	selbstbedienungSetzen,
	offeneEinladungen,
	haushaltsName,
	nutzerName
} from '$lib/server/betrieb/verwaltung';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const betreiber = nurBetreiber(locals);
	const [haushalte, nutzer, selbstbedienung, einladungen] = await Promise.all([
		haushalteUebersicht(),
		nutzerUebersicht(),
		selbstbedienungLesen(),
		offeneEinladungen()
	]);
	return { haushalte, nutzer, selbstbedienung, einladungen, ichSelbst: betreiber.id };
};

export const actions: Actions = {
	haushaltAnlegen: async ({ locals, request, url }) => {
		const betreiber = nurBetreiber(locals);
		const name = String((await request.formData()).get('name') ?? '').trim();
		if (!name) return fail(400, { grund: 'Der Haushalt braucht einen Namen.' });
		const { householdId, token, laeuftAbAm } = await haushaltAnlegenMitEinladung(name, betreiber.id);
		await protokolliere(db, { userId: betreiber.id, aktion: 'haushalt.angelegt', ziel: name, details: { householdId } });
		// Der Link wird EINMAL gezeigt; gespeichert ist nur sein Hash.
		return { link: `${url.origin}/einladung/${token}`, laeuftAbAm, name };
	},

	haushaltLoeschen: async ({ locals, request }) => {
		const betreiber = nurBetreiber(locals);
		const id = String((await request.formData()).get('householdId') ?? '');
		// Der Name VOR dem Loeschen — danach gibt es ihn nicht mehr.
		const name = (await haushaltsName(id)) ?? id;
		try {
			await haushaltLoeschen(id);
		} catch (err) {
			if (err instanceof HaushaltNichtLeer) {
				return fail(409, {
					grund: 'Der Haushalt ist nicht leer. Erst müssen die Leute darin aufräumen — von hier aus wird nichts gelöscht, was jemandem gehört.'
				});
			}
			throw err;
		}
		await protokolliere(db, { userId: betreiber.id, aktion: 'haushalt.geloescht', ziel: name, details: { householdId: id } });
		return { geloescht: true };
	},

	sperren: async ({ locals, request }) => {
		const betreiber = nurBetreiber(locals);
		const form = await request.formData();
		const id = String(form.get('userId') ?? '');
		const an = form.get('an') === 'ja';
		const name = (await nutzerName(id)) ?? id;
		try {
			if (an) await nutzerSperren(id, betreiber.id);
			else await nutzerEntsperren(id);
		} catch (err) {
			if (err instanceof SelbstSperrung) {
				return fail(400, {
					grund: 'Du kannst dich nicht selbst sperren — danach käme niemand mehr hierher.'
				});
			}
			throw err;
		}
		await protokolliere(db, {
			userId: betreiber.id,
			aktion: an ? 'nutzer.gesperrt' : 'nutzer.entsperrt',
			ziel: name,
			details: { userId: id }
		});
		return { gesperrt: an };
	},

	selbstbedienung: async ({ locals, request }) => {
		const betreiber = nurBetreiber(locals);
		const an = (await request.formData()).get('an') === 'ja';
		await selbstbedienungSetzen(an);
		await protokolliere(db, { userId: betreiber.id, aktion: 'selbstbedienung', ziel: 'Instanz', details: { an } });
		return { selbstbedienung: an };
	}
};
