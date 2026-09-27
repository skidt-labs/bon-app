import { fail, redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { berichtLaden } from '$lib/server/berichte/abfragen';
import { filterOptionen, istWahlmerkmal } from '$lib/server/berichte/optionen';
import {
	alsFilter,
	berichtAendern,
	berichtLoeschen,
	berichtSpeichern,
	berichtUmbenennen,
	gespeichertLaden,
	gespeicherteListe,
	istGeaendert
} from '$lib/server/berichte/gespeichert';
import { heutigerTag } from '$lib/server/zeit';
import { filterAlsAdresse, filterAusAdresse, MERKMALE, type Merkmal } from '$lib/berichte/filter';
import type { Actions, PageServerLoad } from './$types';

/** Parameter, die den Bericht steuern, aber kein Filter sind. */
const STEUERUNG = new Set(['bericht', 'wahl']);

export const load: PageServerLoad = async ({ url, locals }) => {
	if (!locals.user) redirect(302, '/auth/login');
	const k = locals.zugriff!;
	const heute = heutigerTag();
	const hinweise: string[] = [];

	const berichtId = url.searchParams.get('bericht');
	const gespeichert = berichtId ? await gespeichertLaden(db, k, berichtId) : null;
	if (berichtId && !gespeichert) hinweise.push('Diesen gespeicherten Bericht gibt es nicht (mehr).');

	// Nur „?bericht=…": der gespeicherte Bericht liefert die Filter. Traegt die Adresse
	// eigene Filter, gilt sie — sie darf vom gespeicherten abweichen, ohne ihn zu aendern.
	const nurBericht = [...url.searchParams.keys()].every((n) => STEUERUNG.has(n));
	const gelesen = gespeichert && nurBericht ? alsFilter(gespeichert, heute) : filterAusAdresse(url.searchParams, heute);
	hinweise.push(...gelesen.hinweise);

	const wahlRoh = url.searchParams.get('wahl');
	const wahl = wahlRoh !== null && MERKMALE.includes(wahlRoh as Merkmal) ? (wahlRoh as Merkmal) : null;
	if (wahlRoh !== null && wahl === null) hinweise.push(`„${wahlRoh}" ist kein Filter — ignoriert.`);

	const [bericht, gespeicherte] = await Promise.all([berichtLaden(db, k, gelesen.filter, heute), gespeicherteListe(db, k)]);
	const optionen = wahl !== null && istWahlmerkmal(wahl) ? await filterOptionen(db, k, bericht.filter, wahl) : null;

	return {
		...bericht,
		heute,
		hinweise: [...new Set([...hinweise, ...bericht.hinweise])],
		wahl,
		optionen,
		gespeicherte,
		aktiv: gespeichert
			? { id: gespeichert.id, name: gespeichert.name, darfAendern: gespeichert.darfAendern, geaendert: istGeaendert(gespeichert, bericht.filter) }
			: null
	};
};

/** Der gezeigte Filter kommt als kanonische Adresse im Formular mit. */
function filterAus(form: FormData) {
	return filterAusAdresse(new URLSearchParams(String(form.get('adresse') ?? '')), heutigerTag()).filter;
}

function zurueck(adresse: string, aktiv: string | null): string {
	return `/reports?${adresse}${aktiv ? `&bericht=${encodeURIComponent(aktiv)}` : ''}`;
}

export const actions: Actions = {
	speichern: async ({ request, locals }) => {
		if (!locals.user) return fail(401, { grund: 'Nicht angemeldet' });
		const form = await request.formData();
		const filter = filterAus(form);
		const r = await berichtSpeichern(db, locals.zugriff!, {
			name: String(form.get('name') ?? ''),
			filter,
			mitZeitraum: form.get('mitZeitraum') === 'ja'
		});
		if (!r.ok) return fail(400, { grund: r.grund });
		redirect(303, zurueck(filterAlsAdresse(filter), r.wert));
	},
	aendern: async ({ request, locals }) => {
		if (!locals.user) return fail(401, { grund: 'Nicht angemeldet' });
		const form = await request.formData();
		const filter = filterAus(form);
		const id = String(form.get('id') ?? '');
		const r = await berichtAendern(db, locals.zugriff!, id, filter);
		if (!r.ok) return fail(400, { grund: r.grund });
		redirect(303, zurueck(filterAlsAdresse(filter), id));
	},
	umbenennen: async ({ request, locals }) => {
		if (!locals.user) return fail(401, { grund: 'Nicht angemeldet' });
		const form = await request.formData();
		const r = await berichtUmbenennen(db, locals.zugriff!, String(form.get('id') ?? ''), String(form.get('name') ?? ''));
		if (!r.ok) return fail(400, { grund: r.grund });
		const aktiv = form.get('aktiv');
		redirect(303, zurueck(filterAlsAdresse(filterAus(form)), typeof aktiv === 'string' && aktiv !== '' ? aktiv : null));
	},
	loeschen: async ({ request, locals }) => {
		if (!locals.user) return fail(401, { grund: 'Nicht angemeldet' });
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		const r = await berichtLoeschen(db, locals.zugriff!, id);
		if (!r.ok) return fail(400, { grund: r.grund });
		const aktiv = form.get('aktiv');
		// War der geloeschte der aktive, bleibt nur die Adresse — ohne Verweis ins Leere.
		redirect(303, zurueck(filterAlsAdresse(filterAus(form)), typeof aktiv === 'string' && aktiv !== '' && aktiv !== id ? aktiv : null));
	}
};
