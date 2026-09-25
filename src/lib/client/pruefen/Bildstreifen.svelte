<script lang="ts">
	import { untrack } from 'svelte';
	import { alsAnteil, ansichtAufRahmen, rahmenAus } from './bildgeometrie';
	import type { OcrZeileKurz } from '$lib/server/ocr/anbieter';

	let {
		bonId,
		zeilen,
		gewaehlt,
		onoeffnen
	}: {
		bonId: string;
		zeilen: OcrZeileKurz[] | null;
		/** Index der OCR-Zeile, die gezeigt werden soll — oder null. */
		gewaehlt: number | null;
		onoeffnen: () => void;
	} = $props();

	/**
	 * Ein Fenster von 236 px Hoehe auf den Bon, das an die Stelle der gewaehlten Position
	 * springt (Entwurf, Handy-Mockup 1). Genug, um die Zeile MIT ihren Nachbarn zu sehen —
	 * beim Pruefen ist der Zusammenhang die halbe Information.
	 *
	 * Ohne Koordinaten wird NICHT gesprungen. Bis zum 17.09.2026 rechnete die alte Ansicht
	 * die Stelle aus der Zeilennummer aus (Zeile 7 von 20 = 35 % der Hoehe) und traf
	 * meistens daneben. Lieber der Anfang des Bons und ein Satz dazu als ein falscher Ort.
	 */
	const HOEHE = 236;

	let fenster = $state<HTMLDivElement | null>(null);
	let bild = $state<HTMLImageElement | null>(null);
	let breite = $state(0);
	let masse = $state({ breite: 0, hoehe: 0 });

	function geladen() {
		if (bild) masse = { breite: bild.naturalWidth, hoehe: bild.naturalHeight };
	}

	// Ein Bild aus dem Cache kann fertig sein, bevor der onload-Haken haengt. Ohne das
	// blieben die Masse auf 0 und der Streifen zeigte immer den Anfang — still und ohne
	// Fehler (dieselbe Falle wie in Bonbild.svelte).
	$effect(() => {
		if (bild?.complete && bild.naturalWidth > 0 && masse.breite === 0) geladen();
	});

	const versatz = $derived.by(() => {
		if (gewaehlt === null || !zeilen || masse.hoehe === 0 || breite === 0) return 0;
		const z = zeilen[gewaehlt];
		if (!z) return 0;
		return ansichtAufRahmen(rahmenAus(z.box), masse, { breite, hoehe: HOEHE }, 1).oben;
	});

	const rahmen = $derived(
		gewaehlt !== null && zeilen?.[gewaehlt] && masse.hoehe > 0
			? alsAnteil(rahmenAus(zeilen[gewaehlt].box), masse)
			: null
	);

	// Sanft nachziehen statt springen, damit man sieht, WOHIN es geht.
	$effect(() => {
		const ziel = versatz;
		if (!fenster) return;
		untrack(() => fenster)?.scrollTo({ top: ziel, behavior: 'smooth' });
	});
</script>

<div class="relative bg-chip">
	<div
		bind:this={fenster}
		bind:clientWidth={breite}
		class="overflow-hidden"
		style="height: {HOEHE}px"
	>
		<button
			type="button"
			class="block w-full cursor-zoom-in text-left"
			onclick={onoeffnen}
			aria-label="Bon im Vollbild öffnen"
		>
			<span class="relative block">
				<img bind:this={bild} src="/receipts/{bonId}/image" alt="Der Bon" class="block w-full" onload={geladen} />
				{#if rahmen}
					<span
						class="pointer-events-none absolute rounded-[3px] border-2 border-tuerkis"
						style="left: {rahmen.x * 100}%; top: {rahmen.y * 100}%; width: {rahmen.breite * 100}%; height: {rahmen.hoehe * 100}%; background-color: color-mix(in srgb, var(--color-tuerkis) 18%, transparent)"
					></span>
				{/if}
			</span>
		</button>
	</div>
	<p
		class="absolute right-0 bottom-0 left-0 bg-papier/85 px-3 py-1 text-[11px] font-semibold text-gedaempft"
	>
		{#if zeilen}
			Tippen zum Vergrößern
		{:else}
			Keine Zeilenkoordinaten — das Bild springt nicht mit
		{/if}
	</p>
</div>
