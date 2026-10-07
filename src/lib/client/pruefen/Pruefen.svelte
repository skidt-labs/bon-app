<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { dialog } from '$lib/client/dialog';
	import { nachKorbFehler } from './rueckfrage';
	import { tick } from 'svelte';
	import { mitWartezustand, nachladenAlle, NACHLADEN_MS } from '$lib/client/warten';
	import { formatCents } from '$lib/money';
	import { describeProblem, DOPPEL_GRUND, KEIN_BON_CODES, keinBonCode } from '$lib/bons/beanstandungen';
	import { dochEinBonAnfrage, nachDochEinBon } from '$lib/client/bons/keinBon';
	import { formatWann } from '$lib/bons/anzeige';
	import Symbol from '$lib/client/geruest/Symbol.svelte';
	import { erneutLesen } from '$lib/client/bons/erneutLesen';
	import { papierkorbAktion, nichtEingereiht, NICHT_EINGEREIHT_KORB } from '$lib/client/bons/papierkorb';
	import { restTage, restTageText } from '$lib/bons/papierkorb';
	import { bildVersion, wartetAufLesen, leseKnopf } from '$lib/bons/anzeige';
	import { bildHochladen, originalHolen } from '$lib/client/bons/bild';
	import BildBearbeiten from '$lib/client/bild/BildBearbeiten.svelte';
	import Bonbild from './Bonbild.svelte';
	import Bildstreifen from './Bildstreifen.svelte';
	import Vollbild from './Vollbild.svelte';
	import Kopfdaten from './Kopfdaten.svelte';
	import Positionen from './Positionen.svelte';
	import { abweichungen as abweichungenAus } from './abweichung';
	import { rechenprobe } from './rechenprobe';
	import {
		zeileEinfuegen,
		zeileLoeschen,
		zeileVerschieben,
		positionssumme,
		pruefeVorBestaetigen,
		handEingabeBegonnen,
		kopieSchluessel,
		selberBon,
		type EditorZeile
	} from './editor';
	import type { OcrZeileKurz } from '$lib/server/ocr/anbieter';
	import type { Stapel } from '$lib/server/receipts/stapel';

	let {
		data
	}: {
		data: {
			receipt: {
				id: string;
				merchantNameRaw: string | null;
				purchasedAt: string | Date | null;
				status: string;
				totalGrossCents: number | null;
				paymentMethod: string | null;
				sichtbarkeit: string;
				privatGewuenscht: boolean | null;
				needsReviewReason: string[] | null;
				vermutetesOriginalId: string | null;
				failureReason: string | null;
				/** Seit wann im Papierkorb — null ausserhalb. */
				verworfenAm: string | Date | null;
				imagePath: string;
				/** Das unbearbeitete Foto, wenn das Bild bearbeitet wurde (bons/bild.ts). */
				originalImagePath: string | null;
			};
			/** Das vermutete Original, sofern sichtbar — siehe bons/doppelt.ts. */
			original: {
				id: string;
				merchantNameRaw: string | null;
				purchasedAt: string | Date | null;
				totalGrossCents: number | null;
				status: string;
			} | null;
			items: EditorZeile[];
			ocrZeilen: OcrZeileKurz[] | null;
			kategorien: { id: string; name: string; oberName: string | null }[];
			stapel: Stapel;
			/** Hochgeladen oder Verwalter: darf verwerfen, zurueckholen, endgueltig loeschen. */
			darfVerwerfen: boolean;
			/** Hat die Cloud-Reserve den Bon gelesen? Dann ein ruhiger Vermerk (Entwurf 2026-10-01). */
			vonReserve?: boolean;
		};
	} = $props();

	// Eigene Kopie: `data` wird bei jeder Navigation ersetzt, die Korrekturen duerfen
	// dabei nicht verlorengehen — und beim Wechsel auf einen ANDEREN Bon muessen sie es.
	let zeilen = $state<EditorZeile[]>([]);
	let kopf = $state({
		merchantNameRaw: null as string | null,
		purchasedAt: null as string | null,
		totalGrossCents: null as number | null,
		paymentMethod: null as string | null,
		/** Der Schalter. Wandert als Teil von `kopf` in den Rumpf der Anfrage. */
		privatBehalten: false
	});
	let geloescht = $state<string[]>([]);
	let angezeigt = $state('');
	let gewaehlt = $state<number | null>(null);
	/** Im Bild angeklickte OCR-Zeile — auch dann, wenn ihr keine Position zugeordnet ist. */
	let bildZeile = $state<number | null>(null);
	let ungueltigeZeilen = $state<number[]>([]);
	let summeUngueltig = $state(false);
	let busy = $state(false);
	let meldung = $state('');
	/** Am Handy: der Bon gross ueber allem. Am Schreibtisch steht er ohnehin daneben. */
	let vollbild = $state(false);

	/**
	 * Ein bestaetigter Bon geht nicht von selbst auf. Er bleibt bestaetigt — die Felder
	 * werden nur entriegelt, wenn jemand „Korrigieren" drueckt. So kann man einen Fehler
	 * nachtraeglich geradeziehen (er faellt oft erst Wochen spaeter auf), ohne dass ein
	 * versehentlicher Tastendruck eine geprueft Zahl veraendert.
	 */
	let bestaetigt = $derived(data.receipt.status === 'confirmed');
	let entriegelt = $state(false);
	/** Als Doppel markiert (2.9): nur ansehen; „Doch kein Doppel" holt ihn zurueck in die Pruefung. */
	const alsDoppel = $derived(data.receipt.status === 'doppelt');
	/** Wartet aufs Lesen (2.6): Band, Felder und Knoepfe gesperrt, die Seite laedt nach. */
	const wartet = $derived(wartetAufLesen(data.receipt.status));
	/** Im Papierkorb: nur ansehen, zurueckholen oder endgueltig loeschen. */
	const imPapierkorb = $derived(data.receipt.status === 'verworfen');
	/** Sieht nicht wie ein Kassenbon aus (ocr/kein-bon.ts) — Band mit Verwerfen / Doch ein Bon. */
	const keinBon = $derived(imPapierkorb || wartet ? null : keinBonCode(data.receipt.needsReviewReason));
	/** 2.12: „Erneut lesen" nur ohne Kein-Bon-Hinweis — mit ihm scheiterte es sicher wieder. */
	const leseWeg = $derived(leseKnopf(data.receipt.status, keinBonCode(data.receipt.needsReviewReason)));
	/** Das vermutete Original liegt im Papierkorb — der Doppel-Hinweis muss das sagen. */
	const originalImPapierkorb = $derived(data.original?.status === 'verworfen');
	const offen = $derived(!wartet && !alsDoppel && !imPapierkorb && (!bestaetigt || entriegelt));
	/** Welche Rueckfrage gerade offen ist — in der Seite, weil confirm() hier nicht taugt. */
	let rueckfrage = $state<null | 'verwerfen' | 'loeschen' | 'bild'>(null);
	/** Ein Fehler aus der Rueckfrage steht IN ihr, sie bleibt dann offen (1.6, 1.7). */
	let rueckfrageFehler = $state('');
	/** Welcher Knopf der Bild-Rueckfrage gerade arbeitet — fuer „Lädt …" (1.7). */
	let arbeit = $state<null | 'bild' | 'original'>(null);

	function fragen(art: 'verwerfen' | 'loeschen' | 'bild') {
		rueckfrage = art;
		rueckfrageFehler = '';
	}
	function rueckfrageSchliessen() {
		rueckfrage = null;
		rueckfrageFehler = '';
	}
	/** Das Foto im Bearbeiten-Bildschirm (bild/BildBearbeiten.svelte), sonst null. */
	let bearbeitung = $state<HTMLImageElement | null>(null);
	/** BildBearbeiten rechnet („Wird vorbereitet …") — sperrt Escape wie das Hochladen (1.7). */
	let bildRechnet = $state(false);
	const version = $derived(bildVersion(data.receipt.imagePath));
	/** Bearbeiten und neu lesen: nur fehlgeschlagene und zu pruefende Bons (Entscheidung 27.09.2026). */
	const bildBearbeitbar = $derived(
		data.darfVerwerfen && (data.receipt.status === 'failed' || data.receipt.status === 'review')
	);
	/**
	 * Der Doppel-Hinweis ist offen, solange niemand „doppelt" oder „eigener Einkauf" gesagt
	 * hat. Bis dahin sperrt der Server das Bestaetigen (confirm/+server.ts) — die Ansicht
	 * sagt es vorher, statt den Menschen in ein 409 laufen zu lassen.
	 */
	const doppelOffen = $derived(data.receipt.status === 'review' && data.receipt.vermutetesOriginalId !== null);

	$effect(() => {
		const schluessel = kopieSchluessel(data.receipt.id, data.receipt.status);
		if (angezeigt === schluessel) return;
		// Review-Fokus 07.10.: Endet das Warten, waehrend am Handy das Vollbild offen ist, bleibt es
		// offen — dasselbe Foto, jetzt mit Zeilen. Zu geht es nur, wenn ein anderer Bon kommt.
		if (!selberBon(angezeigt, schluessel)) vollbild = false;
		angezeigt = schluessel;
		// Ein fehlgeschlagener Bon hat keine Positionen, bestaetigen braucht aber eine:
		// die erste leere Zeile steht schon da, damit man gleich lostippen kann.
		zeilen =
			data.receipt.status === 'failed' && data.items.length === 0
				? zeileEinfuegen([], -1)
				: data.items.map((i) => ({ ...i }));
		const d = data.receipt.purchasedAt;
		kopf = {
			merchantNameRaw: data.receipt.merchantNameRaw,
			purchasedAt: d ? new Date(d).toISOString() : null,
			totalGrossCents: data.receipt.totalGrossCents,
			paymentMethod: data.receipt.paymentMethod,
			// Beim BESTAETIGTEN Bon zeigt der Schalter, was gilt. Beim ungeprueften zeigt er
			// die zuletzt getroffene Entscheidung — und nur, wenn ueberhaupt eine getroffen
			// wurde: `privatGewuenscht` ist null, solange niemand den Schalter angefasst
			// hat. Ein vorangekreuzter Schalter ohne Entscheidung waere eine Behauptung,
			// ein zurueckgesetzter nach einer Entscheidung ein Verlust (Befund R22).
			privatBehalten:
				data.receipt.status === 'confirmed'
					? data.receipt.sichtbarkeit === 'privat'
					: (data.receipt.privatGewuenscht ?? false)
		};
		geloescht = [];
		gewaehlt = null;
		bildZeile = null;
		entriegelt = false;
		meldung = '';
	});

	// 2.6: Solange der Bon aufs Lesen wartet, alle 5 s neu laden. Endet das Warten, wechselt
	// kopieSchluessel, die Kopie kommt aus den neuen Daten, und dieser Effekt raeumt die Uhr weg.
	$effect(() => {
		if (!wartet) return;
		return nachladenAlle(NACHLADEN_MS, invalidateAll);
	});
	/** 2.7: Der Wartezustand endet erst, wenn auch das Neuladen bzw. Weiterblaettern fertig ist. */
	const warte = <T,>(f: () => Promise<T>) => mitWartezustand((an) => (busy = an), f);

	const summe = $derived(positionssumme(zeilen));
	const differenz = $derived(kopf.totalGrossCents === null ? 0 : summe - kopf.totalGrossCents);
	const abw = $derived(abweichungenAus(zeilen, data.ocrZeilen));
	// Ohne den Doppel-Hinweis: der steht ausfuehrlich im eigenen Band darueber.
	const beanstandungen = $derived(
		(data.receipt.needsReviewReason ?? [])
			.filter((c) => c !== DOPPEL_GRUND && !(KEIN_BON_CODES as readonly string[]).includes(c))
			.map(describeProblem)
	);
	/** Zeilen, deren Menge × Einzelpreis nicht zum Gesamtbetrag passt — Hinweis, keine Sperre. */
	const rechnungOffen = $derived(zeilen.filter((z) => rechenprobe(z) !== null).length);

	/**
	 * Was das Bestaetigen sperrt. Neben den Zeilenpruefungen auch die unlesbaren
	 * Eingaben aus Tabelle und Kopfdaten: dort steht dann etwas anderes im Feld, als
	 * gespeichert wuerde — bestaetigen hiesse, eine Zahl festzuschreiben, die der
	 * Mensch gar nicht sieht.
	 */
	const sperren = $derived([
		...pruefeVorBestaetigen(zeilen),
		...(ungueltigeZeilen.length > 0
			? [
					`Der Betrag in ${ungueltigeZeilen.length === 1 ? 'Zeile' : 'den Zeilen'} ${ungueltigeZeilen.join(', ')} ist nicht lesbar.`
				]
			: []),
		...(summeUngueltig ? ['Die Endsumme ist nicht lesbar.'] : []),
		// Beim gelesenen Bon meldet der Worker eine fehlende Summe; beim von Hand
		// eingetragenen stuende er sonst mit 0 EUR in den Berichten.
		...(data.receipt.status === 'failed' && kopf.totalGrossCents === null && !summeUngueltig
			? ['Bitte die Endsumme eintragen.']
			: [])
	]);
	/** Nur bei einem fehlgeschlagenen Bon von Belang: steht schon etwas Eigenes da? */
	const begonnen = $derived(handEingabeBegonnen(kopf, zeilen));

	function waehlen(i: number) {
		gewaehlt = i;
		bildZeile = zeilen[i]?.ocrZeile ?? null;
	}

	/**
	 * Ein Klick ins Bild. Die Zeile wird IMMER hervorgehoben, auch wenn ihr keine
	 * Position zugeordnet ist — sonst passierte beim Klick auf genau die Zeilen nichts,
	 * wegen derer man hinsieht („warum ist das keine Position?").
	 */
	function bildWaehlen(ocrIndex: number) {
		bildZeile = ocrIndex;
		const i = zeilen.findIndex((z) => z.ocrZeile === ocrIndex);
		gewaehlt = i >= 0 ? i : null;
	}

	/** null: nicht gespeichert (die Meldung steht in `meldung`). */
	async function senden(bestaetigen: boolean): Promise<{ doppelt: boolean } | null> {
		meldung = '';
		try {
			const res = await fetch(`/api/receipts/${data.receipt.id}${bestaetigen ? '/confirm' : ''}`, {
				method: bestaetigen ? 'POST' : 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					receipt: kopf,
					// Ausdruecklich die elf Felder des Vertrags, nicht „alles ausser ocrZeile":
					// die geladenen Zeilen tragen auch receiptId, productId und confidence mit,
					// die dort nichts zu suchen haben.
					items: zeilen.map((z) => ({
						id: z.id,
						lineNo: z.lineNo,
						rawText: z.rawText,
						lineType: z.lineType,
						quantity: z.quantity,
						unit: z.unit,
						unitPriceCents: z.unitPriceCents,
						totalPriceCents: z.totalPriceCents,
						vatClass: z.vatClass,
						appliesToLine: z.appliesToLine,
						categoryId: z.categoryId
					})),
					geloescht
				})
			});
			if (!res.ok) {
				const text = await res.text().catch(() => '');
				let satz = `Speichern fehlgeschlagen (HTTP ${res.status}).`;
				try {
					const j = JSON.parse(text) as { message?: string };
					if (j.message) satz = j.message;
				} catch {
					/* kein JSON — der Statussatz bleibt */
				}
				meldung = satz;
				return null;
			}
			geloescht = [];
			// Ein von Hand eingetragener Fehlschlag kann sich als Doppel herausstellen: dann
			// ist er gespeichert, aber NICHT bestaetigt (confirm/+server.ts).
			const antwort = (await res.json().catch(() => null)) as { doppelt?: unknown } | null;
			return { doppelt: antwort?.doppelt === true };
		} catch {
			meldung = 'Keine Verbindung — bitte später noch einmal versuchen.';
			return null;
		}
	}

	/** Weiter im Stapel — aber auf den Bon, der NACH dem Speichern der naechste ist.
	    data.stapel stammt vom Laden und kennt diesen Bon noch als offen. */
	function weiter(bestaetigt: boolean) {
		const ziel = bestaetigt
			? (data.stapel.naechster ?? data.stapel.voriger)
			: data.stapel.naechster;
		return goto(ziel ? `/receipts/${ziel}` : '/inbox');
	}

	async function spaeter() {
		await warte(async () => {
			// Unberuehrter Fehlschlag: nichts senden. Gespeichert waere er ein Bon in Pruefung,
			// und „Erneut lesen" gaebe es fuer ihn nicht mehr.
			if (data.receipt.status === 'failed' && !begonnen) {
				await weiter(false);
				return;
			}
			if (!(await senden(false))) return;
			await weiter(false);
		});
	}

	/** Korrektur an einem bestaetigten Bon: speichern, Status bleibt, Felder wieder zu. */
	async function korrekturSpeichern() {
		if (sperren.length > 0) {
			meldung = sperren[0];
			return;
		}
		await warte(async () => {
			if (!(await senden(false))) return;
			entriegelt = false;
			meldung = 'Korrektur gespeichert.';
		});
	}

	/** Alles zurueck auf den geladenen Stand — ohne Server, ohne Neuladen. */
	function verwerfen() {
		angezeigt = '';
		entriegelt = false;
	}

	/**
	 * Die Entscheidung zum Doppel-Hinweis. Ungespeicherte Korrekturen gehen dabei NICHT
	 * mit: „doppelt" markiert den Bon ohnehin als Doppel, und nach den beiden anderen laedt die Seite
	 * neu. Wer schon korrigiert hat, entscheidet besser zuerst.
	 */
	async function doppelEntscheiden(entscheidung: 'doppelt' | 'eigenerEinkauf' | 'wiederherstellen') {
		await warte(async () => {
			meldung = '';
			try {
				const res = await fetch(`/api/receipts/${data.receipt.id}/doppelt`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ entscheidung })
				});
				if (!res.ok) {
					const j = (await res.json().catch(() => null)) as { message?: string } | null;
					meldung = j?.message ?? `Entscheidung fehlgeschlagen (HTTP ${res.status}).`;
					return;
				}
			} catch {
				meldung = 'Keine Verbindung — bitte später noch einmal versuchen.';
				return;
			}
			if (entscheidung === 'doppelt') {
				await weiter(true);
				return;
			}
			// Neu laden UND die eigene Kopie verwerfen: sonst stuende der alte Stand weiter da.
			// Erst laden, dann zuruecksetzen — sonst baute der Effekt die Kopie aus den alten Daten.
			await invalidateAll();
			angezeigt = '';
		});
	}

	/**
	 * Ein fehlgeschlagener Bon: noch einmal auslesen lassen statt von Hand eintragen —
	 * etwa, wenn nur der Mac gerade nicht erreichbar war. Danach steht er wieder in der
	 * Warteschlange, hier gibt es nichts mehr zu tun.
	 */
	async function nochmalLesen() {
		if (begonnen && !confirm('Was du schon eingetragen hast, geht dabei verloren. Trotzdem neu lesen?')) return;
		await warte(async () => {
			meldung = '';
			const ergebnis = await erneutLesen(data.receipt.id);
			if (!ergebnis.ok) {
				meldung = ergebnis.meldung;
				return;
			}
			await goto('/inbox');
		});
	}

	/**
	 * Papierkorb (bons/papierkorb.ts). Verwerfen fuehrt weiter wie Bestaetigen — der Bon ist
	 * aus dem Stapel —, Loeschen in den Papierkorb der Bonliste, Zurueckholen laedt neu.
	 */
	async function papierkorb(aktion: 'verwerfen' | 'wiederherstellen' | 'loeschen') {
		await warte(async () => {
			meldung = '';
			rueckfrageFehler = '';
			const r = await papierkorbAktion(
				data.receipt.id,
				aktion,
				aktion === 'verwerfen' ? { bestaetigtWegnehmen: bestaetigt } : {}
			);
			if (!r.ok) {
				// Aus der Rueckfrage heraus steht der Fehler IN ihr, sie bleibt offen (1.6); bei
				// brauchtRueckfrage neu laden, damit der naechste Klick bestaetigtWegnehmen schickt (2.3).
				const f = nachKorbFehler(r, rueckfrage !== null);
				rueckfrageFehler = f.rueckfrageFehler;
				meldung = f.meldung;
				if (f.neuLaden) {
					await invalidateAll();
					// Abschlusspruefung 0.11.0: kopieSchluessel ist fuer review und confirmed gleich — ohne
					// das blieben Kopf und Zeilen auf dem alten Stand, und Speichern ueberschriebe die
					// Korrekturen aus dem anderen Tab. Rueckfrage und rueckfrageFehler bleiben stehen.
					angezeigt = '';
				}
				return;
			}
			rueckfrage = null;
			if (aktion === 'verwerfen') return weiter(true);
			if (aktion === 'loeschen') return goto('/receipts?status=papierkorb');
			await invalidateAll();
			// Der Status wechselt, mit ihm kopieSchluessel; der Effekt baut die Kopie neu und leert
			// dabei `meldung` — die Meldung (2.11) deshalb erst nach tick().
			await tick();
			if (nichtEingereiht(r)) meldung = NICHT_EINGEREIHT_KORB;
		});
	}

	/**
	 * „Doch ein Bon, lesen": ein fehlgeschlagener Bon wird ohne Vorpruefung neu gelesen — dann
	 * gibt es hier nichts mehr zu tun; bei einem gelesenen faellt nur der Hinweis weg.
	 */
	async function dochEinBon() {
		// Wie „Erneut lesen": wer schon eingetragen hat, wird gefragt, bevor das verloren geht.
		if (data.receipt.status === 'failed' && begonnen && !confirm('Was du schon eingetragen hast, geht dabei verloren. Trotzdem neu lesen?')) return;
		const vorher = data.receipt.status;
		await warte(async () => {
			meldung = '';
			const r = await dochEinBonAnfrage(data.receipt.id);
			const f = nachDochEinBon(vorher, r);
			if (f.liest) return goto('/inbox');
			// Nur neu laden, NICHT angezeigt zuruecksetzen: sonst waeren Korrekturen, die schon im
			// Feld stehen, weg (Pruefung 27.09.2026). Der Hinweis kommt aus data.receipt; beim
			// Rueckfall auf „fehlgeschlagen" steht er wieder da (2.11).
			if (r.ok) await invalidateAll();
			if (f.meldung) meldung = f.meldung;
		});
	}

	/**
	 * Aus der Rueckfrage: das Foto laden und den Bearbeiten-Bildschirm oeffnen. Die Rueckfrage
	 * bleibt dabei offen („Lädt …") und schliesst erst nach Erfolg; ein Fehler steht in ihr (1.7).
	 */
	async function bildOeffnen() {
		meldung = '';
		rueckfrageFehler = '';
		const bild = await warte(async () => {
			arbeit = 'bild';
			const i = new Image();
			i.src = `/receipts/${data.receipt.id}/image?v=${version}`;
			try {
				await i.decode();
				return i;
			} catch {
				rueckfrageFehler = 'Das Bild ließ sich nicht laden.';
				return null;
			} finally {
				arbeit = null;
			}
		});
		if (!bild) return;
		// `warte` ist durch, busy wieder false. Erst die Rueckfrage schliessen — ihr Abbau gibt den
		// Fokus an „Bild bearbeiten" zurueck, der dafuer frei sein muss —, dann die Ueberlagerung
		// oeffnen: die merkt sich genau diesen Knopf als Rueckweg.
		rueckfrage = null;
		await tick();
		bearbeitung = bild;
	}

	/** Abbrechen in der Ueberlagerung (Knopf oder Escape): verwirft die Bearbeitung. */
	function bildAbbrechen() {
		bearbeitung = null;
		meldung = '';
	}

	async function bildUebernehmen(blob: Blob) {
		await warte(async () => {
			meldung = '';
			const r = await bildHochladen(data.receipt.id, blob);
			if (!r.ok) {
				meldung = r.meldung;
				return;
			}
			bearbeitung = null;
			await goto('/inbox');
		});
	}

	async function originalZurueck() {
		meldung = '';
		rueckfrageFehler = '';
		await warte(async () => {
			arbeit = 'original';
			try {
				const r = await originalHolen(data.receipt.id);
				if (!r.ok) {
					// Im Dialog, der bleibt offen — vorher erschien der Fehler erst nach dem Schliessen (1.7).
					rueckfrageFehler = r.meldung;
					return;
				}
				rueckfrage = null;
				await goto('/inbox');
			} finally {
				arbeit = null;
			}
		});
	}

	async function bestaetigen() {
		if (doppelOffen) {
			meldung = 'Erst entscheiden: doppelt oder eigener Einkauf.';
			return;
		}
		if (sperren.length > 0) {
			meldung = sperren[0];
			return;
		}
		await warte(async () => {
			const ergebnis = await senden(true);
			if (!ergebnis) return;
			if (ergebnis.doppelt) {
				// Nicht weiter: neu laden, dann steht hier das Doppel-Band mit dem Original. Erst
				// laden, dann zuruecksetzen — sonst baute der Effekt die Kopie aus den alten Daten.
				await invalidateAll();
				angezeigt = '';
				return;
			}
			await weiter(true);
		});
	}
</script>

<!--
	Eine Ansicht fuer beide Breiten, nicht zwei Komponenten. Der Unterschied ist die
	ANORDNUNG, nicht die Logik: am Schreibtisch steht der Bon in einer eigenen Spalte
	daneben, am Handy als Streifen darueber, der sich beim Tippen zum Vollbild oeffnet.
	Eine zweite Komponente haette dieselben zweihundert Zeilen Zustand, Senden und
	Pruefen ein zweites Mal getragen — und ein zweites Mal falsch.
-->
{#snippet aktionen(klasse: string)}
	<div class="flex items-center gap-2 {klasse}">
		{#if imPapierkorb}
			<span class="mr-auto text-[12.5px] font-semibold text-gedaempft lg:mr-0">Im Papierkorb</span>
			{#if data.darfVerwerfen}
				<button
					type="button"
					class="rounded-xl border border-linie bg-papier px-3.5 py-2 text-sm font-bold text-rot-dunkel disabled:opacity-60"
					disabled={busy}
					onclick={() => fragen('loeschen')}>Jetzt löschen</button
				>
				<button
					type="button"
					class="rounded-xl bg-tuerkis px-4 py-2 text-sm font-extrabold text-white disabled:opacity-60"
					disabled={busy}
					onclick={() => papierkorb('wiederherstellen')}>Wiederherstellen</button
				>
			{/if}
		{:else if alsDoppel}
			<span class="mr-auto text-[12.5px] font-semibold text-gedaempft lg:mr-0">Als Doppel markiert</span>
		{:else if bestaetigt && !entriegelt}
			<span class="mr-auto text-[12.5px] font-semibold text-gedaempft lg:mr-0">Bestätigt</span>
			<button
				type="button"
				class="rounded-xl border border-linie bg-papier px-4 py-2 text-sm font-bold"
				onclick={() => (entriegelt = true)}>Korrigieren</button
			>
		{:else if bestaetigt}
		<!--
			Der Schalter steht VOR dem Knopf, nicht hinter ihm: er aendert, was das Klicken
			bedeutet. Und darunter steht im Klartext, was passiert — kein Schloss-Symbol,
			das man erst deuten muss.
		-->
		<label class="flex w-full items-start gap-2.5 px-0.5 lg:w-auto">
			<input
				type="checkbox"
				bind:checked={kopf.privatBehalten}
				disabled={busy}
				class="mt-0.5 h-4 w-4 shrink-0 accent-tuerkis"
			/>
			<span class="min-w-0 text-[13px] leading-tight">
				<span class="block font-bold">privat behalten</span>
				<span class="block text-[11.5px] font-semibold text-leise">
					{kopf.privatBehalten ? 'Siehst nur du' : 'Sehen alle im Haushalt'}
				</span>
			</span>
		</label>
			<button
				type="button"
				class="rounded-xl border border-linie bg-papier px-3.5 py-2 text-sm font-bold"
				disabled={busy}
				onclick={verwerfen}>Abbrechen</button
			>
			<button
				type="button"
				class="flex-1 rounded-xl bg-tuerkis px-4 py-2 text-sm font-extrabold text-white disabled:opacity-60 lg:flex-none"
				disabled={busy}
				onclick={korrekturSpeichern}
			>
				{busy ? 'Speichert …' : 'Korrektur speichern'}
			</button>
		{:else}
		<!--
			Der Schalter steht VOR dem Knopf, nicht hinter ihm: er aendert, was das Klicken
			bedeutet. Und darunter steht im Klartext, was passiert — kein Schloss-Symbol,
			das man erst deuten muss.
		-->
		<label class="flex w-full items-start gap-2.5 px-0.5 lg:w-auto">
			<input
				type="checkbox"
				bind:checked={kopf.privatBehalten}
				disabled={busy || wartet}
				class="mt-0.5 h-4 w-4 shrink-0 accent-tuerkis"
			/>
			<span class="min-w-0 text-[13px] leading-tight">
				<span class="block font-bold">privat behalten</span>
				<span class="block text-[11.5px] font-semibold text-leise">
					{kopf.privatBehalten ? 'Siehst nur du' : 'Sehen alle im Haushalt'}
				</span>
			</span>
		</label>
			<button
				type="button"
				class="rounded-xl border border-linie bg-papier px-3.5 py-2 text-sm font-bold disabled:opacity-60"
				disabled={busy || wartet}
				onclick={spaeter}>Später</button
			>
			<button
				type="button"
				class="flex-1 rounded-xl bg-tuerkis px-4 py-2 text-sm font-extrabold text-white disabled:opacity-60 lg:flex-none"
				disabled={busy || wartet}
				onclick={bestaetigen}
			>
				{wartet ? 'Wird gelesen …' : busy ? 'Speichert …' : 'Bestätigen'}
			</button>
		{/if}
	</div>
{/snippet}

<div class="flex min-h-dvh flex-col bg-flaeche font-sans text-tinte lg:h-dvh">
	<header
		class="sticky top-0 z-10 flex items-center gap-3 border-b border-linie bg-papier px-4 py-2.5 lg:static lg:gap-5 lg:px-6"
		style="top: env(safe-area-inset-top, 0px)"
	>
		<a href="/inbox" class="shrink-0 font-semibold text-gedaempft" aria-label="Zurück zum Posteingang"
			>‹<span class="hidden lg:inline"> Posteingang</span></a
		>
		<div class="min-w-0 flex-1 lg:flex-none">
			<b class="block truncate text-[15px] font-extrabold lg:text-[17px]"
				>{kopf.merchantNameRaw ?? 'Unbekannter Händler'}</b
			>
			<span class="text-[12px] text-gedaempft lg:text-[12.5px]">
				{zeilen.length}
				{zeilen.length === 1 ? 'Position' : 'Positionen'}
				{#if data.stapel.position > 0}
					<span class="lg:hidden"> · Bon {data.stapel.position} von {data.stapel.gesamt}</span>
				{/if}
			</span>
		</div>
		{#if data.stapel.position > 0}
			<div class="ml-auto hidden items-center gap-2 font-semibold text-gedaempft lg:flex">
				<a
					href={data.stapel.voriger ? `/receipts/${data.stapel.voriger}` : undefined}
					class="grid h-7 w-7 place-items-center rounded-full border border-linie"
					class:opacity-40={!data.stapel.voriger}
					aria-label="Voriger Bon"><Symbol name="links" size={16} /></a
				>
				<span>Bon {data.stapel.position} von {data.stapel.gesamt} zu prüfen</span>
				<a
					href={data.stapel.naechster ? `/receipts/${data.stapel.naechster}` : undefined}
					class="grid h-7 w-7 place-items-center rounded-full border border-linie"
					class:opacity-40={!data.stapel.naechster}
					aria-label="Nächster Bon"><Symbol name="rechts" size={16} /></a
				>
			</div>
		{:else}
			<span class="ml-auto hidden lg:block"></span>
		{/if}
		{#if bildBearbeitbar}
			<button
				type="button"
				class="shrink-0 rounded-xl border border-linie bg-papier px-3 py-1.5 text-[13px] font-bold disabled:opacity-60"
				disabled={busy}
				onclick={() => fragen('bild')}><span class="hidden sm:inline">Bild bearbeiten</span><span class="sm:hidden">Bild</span></button
			>
		{/if}
		{#if data.darfVerwerfen && !imPapierkorb}
			<button
				type="button"
				class="shrink-0 rounded-xl border border-linie bg-papier px-3 py-1.5 text-[13px] font-bold text-rot-dunkel disabled:opacity-60"
				disabled={busy || wartet}
				onclick={() => fragen('verwerfen')}>Verwerfen</button
			>
		{/if}
		{@render aktionen('hidden lg:flex')}
	</header>

	<div class="grid lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(360px,520px)_1fr]">
		<!-- Am Handy ein Streifen oben, der an die Stelle springt; am Schreibtisch die
		     volle Spalte mit Zoom und Werkzeugleiste. -->
		<div class="lg:hidden">
			<Bildstreifen
				bonId={data.receipt.id}
				bildVersion={version}
				zeilen={data.ocrZeilen}
				gewaehlt={bildZeile}
				onoeffnen={() => (vollbild = true)}
			/>
		</div>
		<aside class="hidden min-h-0 border-r border-linie lg:block">
			<Bonbild
				bonId={data.receipt.id}
				bildVersion={version}
				zeilen={data.ocrZeilen}
				gewaehlt={bildZeile}
				onwaehlen={bildWaehlen}
			/>
		</aside>

		<!-- `content-start` statt fester Zeilenaufteilung: bis zum 27.09.2026 stand hier
		     `grid-rows-[auto_auto_1fr_auto]`, und die dehnbare Zeile war die DRITTE — egal,
		     was dort landete. Mit einem Hinweisband darueber war das nicht mehr die
		     Positionsliste, sondern das Band, und es wuchs auf die halbe Hoehe. -->
		<main
			class="grid gap-3.5 px-4 py-4 pb-28 lg:min-h-0 lg:content-start lg:overflow-y-auto lg:px-6 lg:pb-4"
		>
			{#if wartet}
				<div role="status" class="rounded-xl border border-linie bg-chip px-3.5 py-3 text-[13px] font-semibold text-gedaempft">
					Wird gerade gelesen … Felder und Knöpfe sind so lange gesperrt; die Seite zeigt den Bon von selbst, sobald er
					gelesen ist.
				</div>
			{/if}

			{#if imPapierkorb && data.receipt.verworfenAm}
				<div class="rounded-xl border border-linie bg-chip px-3.5 py-3 text-[13px] font-semibold text-gedaempft">
					Im Papierkorb — {restTageText(restTage(data.receipt.verworfenAm, new Date()))}. Bis dahin lässt er sich wiederherstellen.
				</div>
			{/if}

			{#if alsDoppel}
				<!-- 2.9: „Verwerfen" heisst nur noch Papierkorb. Der Doppel bekommt sein eigenes Band. -->
				<div class="grid gap-2.5 rounded-xl border border-linie bg-chip px-3.5 py-3 text-[13px]">
					<p class="font-semibold text-gedaempft">Als Doppel markiert — zählt in keinem Bericht und keinem Budget.</p>
					<div class="flex flex-wrap gap-2">
						<button
							type="button"
							class="rounded-xl border border-linie bg-papier px-3.5 py-2 text-sm font-bold disabled:opacity-60"
							disabled={busy}
							onclick={() => doppelEntscheiden('wiederherstellen')}>Doch kein Doppel</button
						>
					</div>
				</div>
			{/if}

			{#if keinBon}
				<div class="grid gap-2.5 rounded-xl border border-bernstein bg-bernstein-flaeche px-3.5 py-3 text-[13px]">
					<p class="font-semibold text-bernstein">{describeProblem(keinBon)}</p>
					<div class="flex flex-wrap gap-2">
						{#if data.darfVerwerfen}
							<button
								type="button"
								class="rounded-xl bg-bernstein px-3.5 py-2 text-sm font-extrabold text-white disabled:opacity-60"
								disabled={busy}
								onclick={() => fragen('verwerfen')}>Verwerfen</button
							>
						{/if}
						<!-- Bei „kaum Text" gibt es fuer das Modell nichts zu lesen — es wuerde einen Bon
						     erfinden. Dann bleibt Eintragen von Hand (Pruefung 27.09.2026). -->
						{#if keinBon !== 'kein_bon_leer'}
							<button
								type="button"
								class="rounded-xl border border-linie bg-papier px-3.5 py-2 text-sm font-bold disabled:opacity-60"
								disabled={busy}
								onclick={dochEinBon}>{data.receipt.status === 'failed' ? 'Doch ein Bon, lesen' : 'Doch ein Bon'}</button
							>
						{/if}
					</div>
				</div>
			{/if}

			{#if data.receipt.status === 'failed'}
				<!-- Das Auslesen ging schief, das Bild ist trotzdem da (27.09.2026): entweder von
				     Hand eintragen — die Felder darunter sind offen — oder noch einmal lesen. -->
				<div class="grid gap-2.5 rounded-xl border border-rot bg-rot-flaeche px-3.5 py-3 text-[13px] text-rot-dunkel">
					<p>
						<b class="block font-extrabold">Auslesen fehlgeschlagen{data.receipt.failureReason ? ':' : '.'}</b>
						{#if data.receipt.failureReason}<span class="block">{data.receipt.failureReason}</span>{/if}
						<span class="mt-1 block font-semibold">
							{#if leseWeg === 'erneut'}
								Trag den Bon von Hand ein — Händler, Datum, Endsumme und mindestens eine Position — oder lass ihn
								noch einmal lesen.
							{:else}
								Trag den Bon von Hand ein — Händler, Datum, Endsumme und mindestens eine Position.
							{/if}
						</span>
					</p>
					<!-- 2.12: Mit Kein-Bon-Hinweis scheiterte „Erneut lesen" sicher wieder an derselben
					     Vorpruefung — dann bietet das Band darueber „Doch ein Bon, lesen". -->
					{#if leseWeg === 'erneut'}
						<div class="flex flex-wrap gap-2">
							<button
								type="button"
								class="rounded-xl border border-linie bg-papier px-3.5 py-2 text-sm font-bold text-tinte disabled:opacity-60"
								disabled={busy}
								onclick={nochmalLesen}>Erneut lesen</button
							>
						</div>
					{/if}
				</div>
			{/if}

			{#if doppelOffen}
				<!-- Das Original zum Anklicken: erst vergleichen, dann entscheiden. -->
				<div class="grid gap-2.5 rounded-xl border border-bernstein bg-bernstein-flaeche px-3.5 py-3 text-[13px]">
					<p class="font-semibold text-bernstein">
						{#if data.original}
							Sieht aus wie der Bon vom
							<a class="font-extrabold underline" href="/receipts/{data.original.id}">
								{formatWann(data.original.purchasedAt)} · {data.original.merchantNameRaw ?? 'Unbekannter Händler'}
								· {data.original.totalGrossCents !== null ? `${formatCents(data.original.totalGrossCents)} €` : '—'}</a
							>
							{#if originalImPapierkorb}
								<b class="font-extrabold">— der liegt im Papierkorb.</b> Soll dieser hier bleiben, ist „Eigener Einkauf“ richtig.
							{/if}
						{:else}
							Sieht aus wie ein schon erfasster Bon.
						{/if}
						Gleiche Endsumme, fast gleiche Uhrzeit.
					</p>
					<!-- Liegt das Original im Papierkorb, steht „Eigener Einkauf" vorn: sonst zaehlten
					     am Ende weder das Original noch dieser Bon (Pruefung 27.09.2026). -->
					<div class="flex flex-wrap gap-2" class:flex-row-reverse={originalImPapierkorb} class:justify-end={originalImPapierkorb}>
						<button
							type="button"
							class="rounded-xl px-3.5 py-2 text-sm disabled:opacity-60"
							class:bg-bernstein={!originalImPapierkorb}
							class:text-white={!originalImPapierkorb}
							class:font-extrabold={!originalImPapierkorb}
							class:border={originalImPapierkorb}
							class:border-linie={originalImPapierkorb}
							class:bg-papier={originalImPapierkorb}
							class:font-bold={originalImPapierkorb}
							disabled={busy}
							onclick={() => doppelEntscheiden('doppelt')}>Ist doppelt – nicht zählen</button
						>
						<button
							type="button"
							class="rounded-xl px-3.5 py-2 text-sm disabled:opacity-60"
							class:border={!originalImPapierkorb}
							class:border-linie={!originalImPapierkorb}
							class:bg-papier={!originalImPapierkorb}
							class:font-bold={!originalImPapierkorb}
							class:bg-bernstein={originalImPapierkorb}
							class:text-white={originalImPapierkorb}
							class:font-extrabold={originalImPapierkorb}
							disabled={busy}
							onclick={() => doppelEntscheiden('eigenerEinkauf')}>Eigener Einkauf</button
						>
					</div>
				</div>
			{/if}

			<!-- `display: contents`, damit das fieldset nichts am Aufbau aendert — es dient
			     allein dazu, ALLE Felder darin auf einmal zu sperren. -->
			<fieldset disabled={!offen} class="contents">
				<Kopfdaten
					bind:merchantNameRaw={kopf.merchantNameRaw}
					bind:purchasedAt={kopf.purchasedAt}
					bind:totalGrossCents={kopf.totalGrossCents}
					bind:paymentMethod={kopf.paymentMethod}
					bind:summeUngueltig
				/>

			{#if beanstandungen.length || abw.size || sperren.length || rechnungOffen}
				<div
					class="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-xl bg-bernstein-flaeche px-3.5 py-2.5 text-[13px] font-semibold text-bernstein"
				>
					{#if abw.size}<span
							>{abw.size}
							{abw.size === 1 ? 'Zeile weicht' : 'Zeilen weichen'} vom Bild ab</span
						>{/if}
					{#if rechnungOffen}<span
							>bei {rechnungOffen}
							{rechnungOffen === 1 ? 'Zeile geht' : 'Zeilen geht'} die Rechnung nicht auf</span
						>{/if}
					{#each sperren as s (s)}<span class="text-rot-dunkel">{s}</span>{/each}
					{#if beanstandungen.length}<span>{beanstandungen.join(' · ')}</span>{/if}
				</div>
			{/if}

			{#if data.vonReserve}
				<!-- Cloud-Reserve: ein Hinweis, kein Warnstreifen — er sperrt nichts. -->
				<p class="px-1 text-[12px] text-gedaempft">
					☁ Von der Reserve gelesen (Cloud-Dienst), weil der Mac nicht erreichbar war.
				</p>
			{/if}

			<Positionen
				bind:zeilen
				bind:ungueltigeZeilen
				ocrZeilen={data.ocrZeilen}
				{gewaehlt}
				abweichungen={abw}
				kategorien={data.kategorien}
				onwaehlen={waehlen}
				oneinfuegen={(i) => (zeilen = zeileEinfuegen(zeilen, i))}
				onloeschen={(i) => {
					const r = zeileLoeschen(zeilen, i);
					zeilen = r.zeilen;
					geloescht = [...geloescht, ...r.geloescht];
					gewaehlt = null;
					bildZeile = null;
				}}
				onverschieben={(i, richtung) => {
					zeilen = zeileVerschieben(zeilen, i, richtung);
					// Die Auswahl wandert mit der Zeile, nicht mit der Stelle — sonst
					// zeigt das Bild nach dem Verschieben auf die Nachbarzeile.
					if (gewaehlt === i) gewaehlt = i + richtung;
					else if (gewaehlt === i + richtung) gewaehlt = i;
				}}
				onuebernehmen={(i, cents) => (zeilen[i].totalPriceCents = cents)}
			/>

			<div
				class="flex items-center gap-4 border-t border-linie py-3 text-[13px] font-semibold text-gedaempft"
			>
				<button
					type="button"
					class="font-bold text-tuerkis-dunkel"
					onclick={() => (zeilen = zeileEinfuegen(zeilen, zeilen.length - 1))}>+ Zeile</button
				>
				<span class="ml-auto tabular-nums">
					Positionen <b class="text-tinte">{formatCents(summe)} €</b> · Endsumme
					<b class="text-tinte"
						>{kopf.totalGrossCents !== null ? `${formatCents(kopf.totalGrossCents)} €` : '—'}</b
					>
					{#if kopf.totalGrossCents !== null && differenz !== 0}
						· <b class="text-rot-dunkel">{differenz > 0 ? '+' : ''}{formatCents(differenz)} €</b>
					{/if}
				</span>
			</div>
			</fieldset>
			{#if meldung}<p class="pb-2 text-sm font-semibold text-rot-dunkel">{meldung}</p>{/if}
		</main>
	</div>

	<!-- Am Handy gehoeren die beiden Knoepfe an den unteren Rand, in Daumenweite — in der
	     Kopfzeile waere neben Zurueck, Haendler und Zaehler kein Platz mehr. Der Abstand
	     unten haelt sie ueber der Systemgeste. -->
	<div
		class="fixed inset-x-0 bottom-0 z-10 border-t border-linie bg-papier px-4 pt-2.5 lg:hidden"
		style="padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 10px)"
	>
		{@render aktionen('')}
	</div>
</div>

{#if rueckfrage}
	<div
		class="fixed inset-0 z-50 grid place-items-center bg-tinte/40 px-4"
		role="dialog"
		aria-modal="true"
		aria-labelledby="rueckfrage-titel"
		use:dialog={{ onschliessen: rueckfrageSchliessen, gesperrt: busy }}
	>
		<div class="grid w-full max-w-sm gap-3 rounded-2xl bg-papier p-5 text-[14px]">
			<b id="rueckfrage-titel" class="text-[16px] font-extrabold">
				{rueckfrage === 'verwerfen'
					? 'Bon in den Papierkorb legen?'
					: rueckfrage === 'bild'
						? 'Bild bearbeiten?'
						: 'Bon endgültig löschen?'}
			</b>
			<p class="text-gedaempft">
				{#if rueckfrage === 'bild'}
					Nach dem Bearbeiten wird der Bon neu gelesen, die Positionen werden ersetzt.
					{#if data.receipt.status === 'failed' && begonnen}Was du schon eingetragen hast, geht dabei verloren.{/if}
					{#if data.receipt.originalImagePath}Das unbearbeitete Foto ist gespeichert und lässt sich zurückholen.{/if}
				{:else if rueckfrage === 'loeschen'}
					Bild und Daten sind danach weg. Das lässt sich nicht rückgängig machen.
				{:else if bestaetigt}
					Dieser Bon ist bestätigt. Im Papierkorb zählt er nicht mehr in Berichten und Budgets. 30 Tage lang kannst
					du ihn wiederherstellen.
				{:else}
					30 Tage lang kannst du ihn wiederherstellen, danach wird er gelöscht.
				{/if}
			</p>
			{#if rueckfrageFehler}<p role="alert" class="text-sm font-semibold text-rot-dunkel">{rueckfrageFehler}</p>{/if}
			<div class="flex flex-wrap justify-end gap-2">
				<!-- Fokus beim Oeffnen hierher (1.6); waehrend der Arbeit gesperrt, wie Escape. -->
				<button
					type="button"
					class="rounded-xl border border-linie bg-papier px-4 py-2 text-sm font-bold disabled:opacity-60"
					data-autofocus
					disabled={busy}
					onclick={rueckfrageSchliessen}>Abbrechen</button
				>
				{#if rueckfrage === 'bild'}
					{#if data.receipt.originalImagePath}
						<button
							type="button"
							class="rounded-xl border border-linie bg-papier px-4 py-2 text-sm font-bold disabled:opacity-60"
							disabled={busy}
							onclick={originalZurueck}>{arbeit === 'original' ? 'Wird zurückgeholt …' : 'Original wiederherstellen'}</button
						>
					{/if}
					<button
						type="button"
						class="rounded-xl bg-tuerkis px-4 py-2 text-sm font-extrabold text-white disabled:opacity-60"
						disabled={busy}
						onclick={bildOeffnen}>{arbeit === 'bild' ? 'Lädt …' : 'Bild bearbeiten'}</button
					>
				{:else}
				<button
					type="button"
					class="rounded-xl bg-rot-dunkel px-4 py-2 text-sm font-extrabold text-white disabled:opacity-60"
					disabled={busy}
					onclick={() => papierkorb(rueckfrage === 'loeschen' ? 'loeschen' : 'verwerfen')}
				>
					{rueckfrage === 'loeschen' ? 'Löschen' : 'In den Papierkorb'}
				</button>
				{/if}
			</div>
		</div>
	</div>
{/if}


{#if bearbeitung}
	<!-- Bild bearbeiten (bons/bild.ts): derselbe Bildschirm wie beim Scannen. -->
	<!-- Escape = Abbrechen, gesperrt waehrend Vorbereiten und Hochladen; Fokus auf den
	     Hauptknopf und danach zurueck auf „Bild bearbeiten" (1.7). -->
	<div
		class="fixed inset-0 z-50 overflow-y-auto bg-flaeche px-4 py-4"
		role="dialog"
		aria-modal="true"
		aria-label="Bild bearbeiten"
		use:dialog={{ onschliessen: bildAbbrechen, gesperrt: busy || bildRechnet }}
	>
		<div class="mx-auto grid max-w-xl gap-3">
			<BildBearbeiten
				bild={bearbeitung}
				hauptText={busy ? 'Wird hochgeladen …' : 'Übernehmen und neu lesen'}
				beschaeftigt={busy}
				onfertig={bildUebernehmen}
				bind:rechnet={bildRechnet}
				onabbrechen={bildAbbrechen}
			/>
			{#if meldung}<p class="text-sm font-semibold text-rot-dunkel">{meldung}</p>{/if}
		</div>
	</div>
{/if}

{#if vollbild}
	<Vollbild
		bonId={data.receipt.id}
				bildVersion={version}
		zeilen={data.ocrZeilen}
		gewaehlt={bildZeile}
		onwaehlen={(i) => {
			bildWaehlen(i);
			vollbild = false;
		}}
		onschliessen={() => (vollbild = false)}
	/>
{/if}
