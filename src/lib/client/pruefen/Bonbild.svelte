<script lang="ts">
	import { untrack } from 'svelte';
	import { alsAnteil, rahmenAus, rahmenUnterPunkt, ansichtAufRahmen, naechsteZoomStufe } from './bildgeometrie';
	import type { OcrZeileKurz } from '$lib/server/ocr/anbieter';

	let {
		bonId,
		zeilen,
		gewaehlt,
		onwaehlen
	}: {
		bonId: string;
		zeilen: OcrZeileKurz[] | null;
		/** Index der hervorgehobenen Zeile, oder null. */
		gewaehlt: number | null;
		onwaehlen: (index: number) => void;
	} = $props();

	let huelle = $state<HTMLDivElement | null>(null);
	let bild = $state<HTMLImageElement | null>(null);
	let zoom = $state(1);
	let masse = $state({ breite: 0, hoehe: 0 });
	let schwebt = $state<number | null>(null);

	// Die natuerliche Groesse steht erst fest, wenn das Bild geladen ist. Bis dahin
	// sitzen keine Rahmen — sie waeren ohne Massstab an der falschen Stelle.
	function geladen() {
		if (bild) masse = { breite: bild.naturalWidth, hoehe: bild.naturalHeight };
	}

	// Ein Bild aus dem Cache kann fertig sein, bevor der onload-Haken haengt. Ohne das
	// hier blieben die Masse auf 0 und es gaebe nie einen Rahmen — still und ohne Fehler.
	$effect(() => {
		if (bild?.complete && bild.naturalWidth > 0 && masse.breite === 0) geladen();
	});

	// Die gewaehlte Zeile ins Sichtfenster rollen. `zoom` wird bewusst untracked
	// gelesen: sonst risse jeder Klick auf +/− die Ansicht zur gewaehlten Zeile zurueck,
	// obwohl der Mensch gerade woanders hinsieht.
	$effect(() => {
		const z = zeilen;
		const i = gewaehlt;
		if (i === null || !z || !huelle || masse.hoehe === 0) return;
		const { links, oben } = ansichtAufRahmen(
			rahmenAus(z[i].box),
			masse,
			{ breite: huelle.clientWidth, hoehe: huelle.clientHeight },
			untrack(() => zoom)
		);
		huelle.scrollTo({ left: links, top: oben, behavior: 'smooth' });
	});

	/** Bildschirmpunkt → Punkt im Originalbild. null, wenn noch nichts gemessen ist. */
	function punktImBild(ev: MouseEvent): { x: number; y: number } | null {
		if (!bild || masse.breite === 0) return null;
		const kasten = bild.getBoundingClientRect();
		if (kasten.width === 0 || kasten.height === 0) return null;
		return {
			x: ((ev.clientX - kasten.left) / kasten.width) * masse.breite,
			y: ((ev.clientY - kasten.top) / kasten.height) * masse.hoehe
		};
	}

	// Ein Klickfaenger, nicht einer je Zeile: bei ueberlappenden Kaesten gewinnt so der
	// kleinere (rahmenUnterPunkt, geprueft), statt dass der zufaellig obenliegende das
	// Ereignis schluckt. Und ein langer Bon legt nicht sechzig unsichtbare Schaltflaechen
	// in den Tab-Weg zur Werkzeugleiste — bedient wird ueber die Tabelle daneben.
	function klick(ev: MouseEvent) {
		if (!zeilen) return;
		const punkt = punktImBild(ev);
		const treffer = punkt && rahmenUnterPunkt(zeilen, punkt);
		if (treffer !== null && treffer !== undefined) onwaehlen(treffer);
	}

	function bewegt(ev: MouseEvent) {
		if (!zeilen) return;
		const punkt = punktImBild(ev);
		schwebt = punkt ? rahmenUnterPunkt(zeilen, punkt) : null;
	}

	const rahmen = $derived(
		zeilen && masse.hoehe > 0
			? [
					...(gewaehlt !== null ? [{ i: gewaehlt, aktiv: true }] : []),
					...(schwebt !== null && schwebt !== gewaehlt ? [{ i: schwebt, aktiv: false }] : [])
				].map((e) => ({ ...e, r: alsAnteil(rahmenAus(zeilen[e.i].box), masse) }))
			: []
	);
</script>

<div class="flex h-full flex-col bg-chip">
	<div bind:this={huelle} class="min-h-0 flex-1 overflow-auto">
		<div class="relative mx-auto" style="width: {zoom * 100}%">
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
			<img
				bind:this={bild}
				src="/receipts/{bonId}/image"
				alt="Der Bon"
				class="block w-full"
				class:cursor-pointer={schwebt !== null}
				onload={geladen}
				onclick={klick}
				onmousemove={bewegt}
				onmouseleave={() => (schwebt = null)}
			/>
			<!-- Nur der gewaehlte und der ueberfahrene Rahmen, nicht alle: sechzig Kaesten
			     ueber einem Bon sind Rauschen, kein Hinweis. Rein zur Anzeige — die Klicks
			     faengt das Bild. -->
			{#each rahmen as k (k.i)}
				<div
					class="pointer-events-none absolute rounded-[3px] border-2 transition-colors"
					class:border-tuerkis={k.aktiv}
					class:bg-tuerkis-flaeche={k.aktiv}
					class:border-tuerkis-dunkel={!k.aktiv}
					style="left: {k.r.x * 100}%; top: {k.r.y * 100}%; width: {k.r.breite * 100}%; height: {k.r.hoehe * 100}%; {k.aktiv ? 'background-color: color-mix(in srgb, var(--color-tuerkis) 18%, transparent);' : ''}"
				></div>
			{/each}
		</div>
	</div>

	<div class="flex items-center gap-2 border-t border-linie bg-papier/80 px-4 py-2.5 text-[12.5px] text-gedaempft">
		<button
			type="button"
			class="grid h-7 w-8 place-items-center rounded-lg border border-linie bg-papier font-bold text-tinte"
			onclick={() => (zoom = naechsteZoomStufe(zoom, -1))}
			aria-label="Kleiner">−</button
		>
		<span class="min-w-12 text-center font-bold text-tinte tabular-nums">{Math.round(zoom * 100)} %</span>
		<button
			type="button"
			class="grid h-7 w-8 place-items-center rounded-lg border border-linie bg-papier font-bold text-tinte"
			onclick={() => (zoom = naechsteZoomStufe(zoom, 1))}
			aria-label="Größer">+</button
		>
		<button
			type="button"
			class="rounded-lg border border-linie bg-papier px-2.5 py-1 font-bold text-tinte"
			onclick={() => (zoom = 1)}>Anpassen</button
		>
		{#if zeilen}
			<span class="ml-auto italic">Klick auf eine Zeile im Bild wählt die Position</span>
		{:else}
			<!-- Eine Leerstelle, kein geratener Sprung: vor dem 17.09. sprang das Bild an
			     eine gerechnete Stelle (Zeile 7 von 20 = 35 % der Hoehe) und traf meistens
			     daneben. Lieber gar kein Rahmen als ein falscher. -->
			<span class="ml-auto italic">Für diesen Bon liegen keine Zeilenkoordinaten vor</span>
		{/if}
	</div>
</div>
