<script lang="ts">
	import { formatCents } from '$lib/money';
	import Symbol from '$lib/client/geruest/Symbol.svelte';
	import Betragsfeld from './Betragsfeld.svelte';
	import { ART_TEXT, MONETAER, ZEILENARTEN, type EditorZeile } from './editor';
	import { rechenprobe } from './rechenprobe';
	import type { OcrZeileKurz } from '$lib/server/ocr/anbieter';

	let {
		zeilen = $bindable(),
		ungueltigeZeilen = $bindable([]),
		ocrZeilen,
		gewaehlt,
		abweichungen,
		kategorien,
		onwaehlen,
		oneinfuegen,
		onloeschen,
		onverschieben,
		onuebernehmen
	}: {
		zeilen: EditorZeile[];
		/** Zeilennummern, deren Betragsfeld gerade unlesbar ist — der Aufrufer sperrt damit
		    das Bestaetigen. Ohne diesen Weg nach aussen waere die Sperre nur ein Kommentar. */
		ungueltigeZeilen?: number[];
		ocrZeilen: OcrZeileKurz[] | null;
		gewaehlt: number | null;
		/** Je Zeilennummer der Betrag, der im Bild steht (aus abweichung.ts). */
		abweichungen: Map<number, number>;
		kategorien: { id: string; name: string; oberName: string | null }[];
		onwaehlen: (index: number) => void;
		oneinfuegen: (nachIndex: number) => void;
		onloeschen: (index: number) => void;
		onverschieben: (index: number, richtung: 1 | -1) => void;
		onuebernehmen: (index: number, cents: number) => void;
	} = $props();

	/**
	 * Zwei Zeilen je Position statt acht Spalten.
	 *
	 * Die Tabelle davor brauchte rund 900 px und bekam bei einem 1440-px-Fenster 808,
	 * bei 1280 px nur 648 — es fielen ausgerechnet Einzelpreis, Gesamtbetrag und
	 * Kategorie rechts heraus, und der Rollbalken sass versteckt in der Karte. Man kam
	 * an die Menge heran und an die Preise nicht (gemeldet am 17.09.2026).
	 *
	 * Ein Bon ist ohnehin zweizeilig aufgebaut: oben, was gekauft wurde und was es
	 * gekostet hat; darunter, wie es sich zusammensetzt. Dieselbe Form braucht auch die
	 * Handy-Ansicht (Etappe 4) — sie wird damit einmal gebaut statt zweimal.
	 */

	/** Derselbe Schluessel wie im each-Block: an der Zeile, nicht am Index. */
	const schluessel = (z: EditorZeile) => z.id ?? `neu-${z.lineNo}`;

	/** Welche Betragsfelder gerade Unlesbares tragen — je Zeilenschluessel und Feld. */
	let kaputt = $state<Record<string, boolean>>({});

	const ungueltig = $derived(
		new Set(
			zeilen.filter((z) => kaputt[`${schluessel(z)}:gesamt`] || kaputt[`${schluessel(z)}:einzel`]).map((z) => z.lineNo)
		)
	);
	$effect(() => {
		ungueltigeZeilen = [...ungueltig];
	});

	/** Leeres Textfeld heisst „nichts angegeben", nicht „der leere Text". */
	function leerIstNull(i: number, feld: 'quantity' | 'unit') {
		if (zeilen[i][feld]?.trim() === '') zeilen[i][feld] = null;
	}
</script>

<ul class="overflow-hidden rounded-2xl bg-papier shadow-[0_0_0_1px_var(--color-linie)]">
	{#each zeilen as zeile, i (schluessel(zeile))}
		{@const imBild = abweichungen.get(zeile.lineNo)}
		{@const k = schluessel(zeile)}
		{@const istGeld = MONETAER.includes(zeile.lineType)}
		{@const rechnung = rechenprobe(zeile)}
		<!-- Ein Klick irgendwo waehlt die Position; onfocusin tut dasselbe fuer die
		     Tastatur, damit das Bild beim Durchtabben mitgeht. -->
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<li
			class="border-linie px-3 py-2.5"
			class:border-t={i > 0}
			class:bg-tuerkis-flaeche={i === gewaehlt}
			style="box-shadow: inset 3px 0 0 {i === gewaehlt
				? 'var(--color-tuerkis)'
				: imBild !== undefined
					? 'var(--color-rot)'
					: 'transparent'}"
			onclick={() => onwaehlen(i)}
			onfocusin={() => onwaehlen(i)}
		>
			<!-- Erste Zeile: was es ist und was es gekostet hat -->
			<div class="flex items-center gap-2">
				<span class="w-6 shrink-0 text-right text-[12px] text-leise tabular-nums">{zeile.lineNo}</span>
				<select
					bind:value={zeile.lineType}
					class="shrink-0 rounded-lg border border-linie bg-papier px-1.5 py-1 text-[12px] font-bold"
					aria-label="Art der Zeile {zeile.lineNo}"
				>
					{#each ZEILENARTEN as art (art)}<option value={art}>{ART_TEXT[art]}</option>{/each}
				</select>
				<input
					bind:value={zeile.rawText}
					class="min-w-0 flex-1 rounded-lg border border-linie bg-papier px-2 py-1 text-[13px] font-semibold"
					placeholder="Bezeichnung"
					aria-label="Bezeichnung der Zeile {zeile.lineNo}"
				/>
				<Betragsfeld
					bind:cents={zeilen[i].totalPriceCents}
					onungueltig={(u) => (kaputt[`${k}:gesamt`] = u)}
					ariaLabel="Gesamtbetrag der Zeile {zeile.lineNo}"
					class="w-24 shrink-0 px-2 py-1 text-[13px] font-bold"
				/>
			</div>

			<!-- Zweite Zeile: wie er zustande kommt, und die Handgriffe -->
			<div class="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1.5 pl-8 text-[12px] text-gedaempft">
				<input
					bind:value={zeilen[i].quantity}
					onblur={() => leerIstNull(i, 'quantity')}
					class="w-14 rounded-lg border border-linie bg-papier px-1.5 py-0.5 text-right tabular-nums"
					placeholder="Menge"
					aria-label="Menge der Zeile {zeile.lineNo}"
				/>
				<input
					bind:value={zeilen[i].unit}
					onblur={() => leerIstNull(i, 'unit')}
					class="w-14 rounded-lg border border-linie bg-papier px-1.5 py-0.5"
					placeholder="Einh."
					aria-label="Einheit der Zeile {zeile.lineNo}"
				/>
				<span aria-hidden="true">×</span>
				<Betragsfeld
					bind:cents={zeilen[i].unitPriceCents}
					onungueltig={(u) => (kaputt[`${k}:einzel`] = u)}
					leerErlaubt
					ariaLabel="Einzelpreis der Zeile {zeile.lineNo}"
					class="w-20 px-1.5 py-0.5"
				/>
				<span aria-hidden="true">€</span>

				<select
					bind:value={zeile.categoryId}
					class="max-w-44 rounded-lg border border-linie bg-papier px-1.5 py-0.5"
					aria-label="Kategorie der Zeile {zeile.lineNo}"
				>
					<option value={null}>Unsortiert</option>
					{#each kategorien as kat (kat.id)}
						<option value={kat.id}>{kat.oberName ? `${kat.oberName} › ${kat.name}` : kat.name}</option>
					{/each}
				</select>

				{#if istGeld && zeile.lineType !== 'article'}
					<label class="flex items-center gap-1">
						gehört zu
						<input
							type="number"
							min="1"
							bind:value={zeile.appliesToLine}
							class="w-12 rounded border border-linie bg-papier px-1 tabular-nums"
						/>
					</label>
				{/if}

				<span class="ml-auto flex shrink-0 items-center gap-0.5">
					<button
						type="button"
						class="grid h-6 w-6 place-items-center rounded text-gedaempft disabled:opacity-25"
						disabled={i === 0}
						title="Nach oben"
						aria-label="Zeile {zeile.lineNo} nach oben"
						onclick={() => onverschieben(i, -1)}>↑</button
					>
					<button
						type="button"
						class="grid h-6 w-6 place-items-center rounded text-gedaempft disabled:opacity-25"
						disabled={i === zeilen.length - 1}
						title="Nach unten"
						aria-label="Zeile {zeile.lineNo} nach unten"
						onclick={() => onverschieben(i, 1)}>↓</button
					>
					<button
						type="button"
						class="grid h-6 w-6 place-items-center rounded font-bold text-tuerkis-dunkel"
						title="Zeile darunter einfügen"
						aria-label="Zeile unter {zeile.lineNo} einfügen"
						onclick={() => oneinfuegen(i)}>+</button
					>
					<button
						type="button"
						class="grid h-6 w-6 place-items-center rounded font-bold text-rot-dunkel"
						title="Zeile löschen"
						aria-label="Zeile {zeile.lineNo} löschen"
						onclick={() => onloeschen(i)}>×</button
					>
				</span>
			</div>

			<!-- Weitere Zeilen nur, wenn es etwas zu sagen gibt -->
			{#if rechnung}
				<!-- Die Rechenprobe SPERRT NICHT (Entscheidung vom 17.09.2026): es gibt echte
				     Bons, bei denen die Rechnung wegen Rabatt oder Rundung nicht aufgeht.
				     Angeboten wird das Leeren, nicht das Ausrechnen — druckt der Bon keinen
				     Einzelpreis, ist die richtige Antwort eine Leerstelle, keine Zahl. -->
				<p class="mt-1.5 flex flex-wrap items-center gap-2 pl-8 text-[11.5px] font-bold text-bernstein">
					{zeile.quantity} × {formatCents(Math.abs(zeile.unitPriceCents ?? 0))} ergibt
					{formatCents(rechnung.erwartet)} — hier stehen {formatCents(Math.abs(zeile.totalPriceCents))}
					<button
						type="button"
						class="rounded-md border border-bernstein-strich px-2 py-0.5 font-extrabold text-bernstein"
						onclick={() => (zeilen[i].unitPriceCents = null)}
					>
						Einzelpreis entfernen
					</button>
				</p>
			{/if}
			{#if imBild !== undefined}
				<p class="mt-1.5 flex flex-wrap items-center gap-2 pl-8 text-[11.5px] font-bold text-rot-dunkel">
					<Symbol name="links" size={13} />
					Im Bild steht {formatCents(imBild)} — gelesen wurde {formatCents(zeile.totalPriceCents)}
					<button
						type="button"
						class="rounded-md bg-tuerkis px-2 py-0.5 font-extrabold text-white"
						onclick={() => onuebernehmen(i, imBild)}
					>
						{formatCents(imBild)} übernehmen
					</button>
				</p>
			{/if}
			{#if ocrZeilen && zeile.ocrZeile !== null}
				<p class="mt-1 pl-8 font-mono text-[11px] text-leise">OCR: {ocrZeilen[zeile.ocrZeile]?.text}</p>
			{/if}
		</li>
	{/each}
</ul>
