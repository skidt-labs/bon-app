import { fail } from '@sveltejs/kit';
import { nurBetreiber } from '$lib/server/betrieb/zugang';
import {
	anbieterAendern,
	anbieterAktivieren,
	anbieterAnlegen,
	anbieterListe,
	anbieterLoeschen,
	AnbieterAktiv,
	AnbieterNichtGefunden,
	eingabeAusFormular,
	geheimnisVorhanden,
	kiStandLesen,
	NichtGetestet,
	SchluesselFehlt,
	zurueckAufEnv
} from '$lib/server/betrieb/ki';
import { anbieterTesten, gespeicherterSchluessel, modelleAbrufen } from '$lib/server/betrieb/ki-probe';
import { bildwegIstBestaetigt, konfigAusEnv } from '$lib/server/extraction';
import { ocrKonfigurationAusEnv } from '$lib/server/ocr/konfiguration';
import { BildwegNichtFreigegeben, KiSchluesselUnlesbar } from '$lib/server/ki/fehler';
import type { Actions, PageServerLoad } from './$types';

/** Was die .env gerade sagt — nur zur Anzeige, und ohne Schluessel. */
function envStand() {
	try {
		const k = konfigAusEnv();
		return { weg: k.weg, modell: k.model, baseUrl: k.baseUrl, fehler: null };
	} catch (err) {
		return { weg: null, modell: null, baseUrl: null, fehler: err instanceof Error ? err.message : String(err) };
	}
}

/** Der Satz, warum „Zurück auf .env" nicht geht — auf der Seite UND in der Action-Antwort. */
function zurueckGesperrt(fehler: string): string {
	return `Zurück auf .env geht erst, wenn die .env vollständig ist: ${fehler}.`;
}

function ocrStand() {
	try {
		const o = ocrKonfigurationAusEnv();
		return { engine: o.engine, paddleUrl: o.paddleUrl, mitBoxen: o.mitBoxen, fehler: null };
	} catch (err) {
		return { engine: null, paddleUrl: null, mitBoxen: null, fehler: err instanceof Error ? err.message : String(err) };
	}
}

export const load: PageServerLoad = async ({ locals }) => {
	nurBetreiber(locals);
	const [anbieter, stand] = await Promise.all([anbieterListe(), kiStandLesen()]);
	const env = envStand();
	return {
		anbieter,
		aktivId: stand.aktivId,
		env,
		zurueckGesperrt: env.fehler ? zurueckGesperrt(env.fehler) : null,
		ocr: ocrStand(),
		bildwegFrei: bildwegIstBestaetigt(),
		geheimnisDa: geheimnisVorhanden()
	};
};

const id = (f: FormData) => String(f.get('id') ?? '');

const BILDWEG_SATZ =
	'Dieser Anbieter schickt das Bon-Foto hinaus. Das ist erst möglich, wenn in der .env EXTRACTION_BILDWEG_BESTAETIGT=ja steht.';

export const actions: Actions = {
	anlegen: async ({ locals, request }) => {
		const b = nurBetreiber(locals);
		const r = eingabeAusFormular(await request.formData());
		if (!r.ok) return fail(400, { grund: r.grund });
		try {
			await anbieterAnlegen(r.eingabe, b.id);
		} catch (err) {
			if (err instanceof SchluesselFehlt) return fail(400, { grund: err.message });
			if (err instanceof BildwegNichtFreigegeben) return fail(409, { grund: BILDWEG_SATZ });
			throw err;
		}
		return { gespeichert: true };
	},

	aendern: async ({ locals, request }) => {
		const b = nurBetreiber(locals);
		const f = await request.formData();
		const r = eingabeAusFormular(f);
		if (!r.ok) return fail(400, { grund: r.grund, id: id(f) });
		try {
			await anbieterAendern(id(f), r.eingabe, b.id);
		} catch (err) {
			if (err instanceof SchluesselFehlt) return fail(400, { grund: err.message, id: id(f) });
			if (err instanceof BildwegNichtFreigegeben) return fail(409, { grund: BILDWEG_SATZ, id: id(f) });
			if (err instanceof AnbieterNichtGefunden) return fail(404, { grund: 'Diesen Anbieter gibt es nicht mehr.' });
			throw err;
		}
		return { gespeichert: true };
	},

	testen: async ({ locals, request }) => {
		const b = nurBetreiber(locals);
		const f = await request.formData();
		try {
			const r = await anbieterTesten(id(f), b.id);
			return { getestet: id(f), ...r };
		} catch (err) {
			if (err instanceof AnbieterNichtGefunden) return fail(404, { grund: 'Diesen Anbieter gibt es nicht mehr.' });
			throw err;
		}
	},

	aktivieren: async ({ locals, request }) => {
		const b = nurBetreiber(locals);
		const f = await request.formData();
		try {
			await anbieterAktivieren(id(f), b.id);
		} catch (err) {
			if (err instanceof NichtGetestet) {
				return fail(409, { grund: 'Erst testen: aktiviert wird nur ein Anbieter, dessen letzter Test nach der letzten Änderung erfolgreich war.' });
			}
			if (err instanceof BildwegNichtFreigegeben) {
				return fail(409, { grund: BILDWEG_SATZ });
			}
			if (err instanceof AnbieterNichtGefunden) return fail(404, { grund: 'Diesen Anbieter gibt es nicht mehr.' });
			throw err;
		}
		return { aktiviert: true };
	},

	zurueck: async ({ locals }) => {
		const b = nurBetreiber(locals);
		// Eine unvollstaendige .env wuerde der Worker erst beim naechsten Bon bemerken — dann
		// laege jeder Bon in Wiederholungen. Also gar nicht erst umschalten.
		const { fehler } = envStand();
		if (fehler) return fail(409, { grund: zurueckGesperrt(fehler) });
		await zurueckAufEnv(b.id);
		return { aktiviert: true };
	},

	loeschen: async ({ locals, request }) => {
		const b = nurBetreiber(locals);
		const f = await request.formData();
		try {
			await anbieterLoeschen(id(f), b.id);
		} catch (err) {
			if (err instanceof AnbieterAktiv) return fail(409, { grund: 'Der aktive Anbieter lässt sich nicht löschen. Erst einen anderen aktivieren oder zurück auf .env.' });
			if (err instanceof AnbieterNichtGefunden) return fail(404, { grund: 'Diesen Anbieter gibt es nicht mehr.' });
			throw err;
		}
		return { geloescht: true };
	},

	modelle: async ({ locals, request }) => {
		nurBetreiber(locals);
		const f = await request.formData();
		const baseUrl = String(f.get('baseUrl') ?? '').trim();
		if (!/^https?:\/\//.test(baseUrl)) return fail(400, { grund: 'Erst eine Basis-URL mit http:// oder https:// eintragen.' });
		let schluessel = String(f.get('schluessel') ?? '').trim();
		if (!schluessel && id(f)) {
			try {
				// Nur fuer die gespeicherte URL — an eine neu eingetippte geht er nicht.
				schluessel = await gespeicherterSchluessel(id(f), baseUrl);
			} catch (err) {
				if (err instanceof KiSchluesselUnlesbar || err instanceof SchluesselFehlt) {
					return fail(400, { grund: 'Der gespeicherte Schlüssel ist nicht lesbar — bitte neu eingeben.' });
				}
				throw err;
			}
		}
		const r = await modelleAbrufen(baseUrl, schluessel);
		return r.ok ? { modelle: r.modelle, fuer: id(f) || 'neu' } : fail(502, { grund: r.grund });
	}
};
