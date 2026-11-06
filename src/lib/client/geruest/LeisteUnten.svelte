<script lang="ts">
	import { goto } from '$app/navigation';
	import Symbol from './Symbol.svelte';
	import { SEITEN, HANDY_ZIELE, type SeitenId } from './navigation';
	import { uebergeben, type Quelle } from '$lib/client/scannen/uebergabe';
	import { leistenTransform } from './zoom';

	let { aktiv, zaehler }: { aktiv: SeitenId | null; zaehler: number } = $props();

	/** Die Knoepfe Kamera und Datei: Fotos an /scan uebergeben, dort geht es gleich
	    ins Zuschneiden. Den Wert leeren, sonst feuert dieselbe Datei kein zweites change. */
	function gewaehlt(event: Event, quelle: Quelle) {
		const input = event.currentTarget as HTMLInputElement;
		const dateien = Array.from(input.files ?? []);
		input.value = '';
		if (dateien.length === 0) return;
		uebergeben(dateien, quelle);
		goto('/scan');
	}

	// Beim Zoomen folgt die Leiste dem sichtbaren Ausschnitt und behaelt ihre Groesse
	// (zoom.ts). Pro Bild hoechstens einmal rechnen: resize/scroll feuern waehrend der
	// Geste sehr oft; kurzes Nachziehen ist in Ordnung (Spezifikation 0.12.0).
	let leiste = $state<HTMLElement | null>(null);
	$effect(() => {
		const vv = window.visualViewport;
		const el = leiste;
		if (!vv || !el) return;
		let bild = 0;
		const setzen = () => {
			bild = 0;
			el.style.transform =
				leistenTransform(vv, document.documentElement.clientHeight) ?? '';
		};
		const planen = () => {
			if (!bild) bild = requestAnimationFrame(setzen);
		};
		vv.addEventListener('resize', planen);
		vv.addEventListener('scroll', planen);
		setzen();
		return () => {
			vv.removeEventListener('resize', planen);
			vv.removeEventListener('scroll', planen);
			if (bild) cancelAnimationFrame(bild);
			el.style.transform = '';
		};
	});
</script>

<!-- Fest unten, fuenf Plaetze, daumengross. Kamera und Datei als erhoehte Knoepfe: das
     ist, wofuer die App zuerst da ist — ein Tipp oeffnet direkt Kamera bzw. Auswahl.
     `env(safe-area-inset-bottom)` haelt die Leiste ueber der Systemgeste des Handys.
     `transform-origin: 0 100%` gehoert zur Zoom-Verschiebung (zoom.ts). -->
<nav
	bind:this={leiste}
	class="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t border-linie bg-papier px-1 pt-2 lg:hidden"
	style="padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 10px); transform-origin: 0 100%"
	aria-label="Hauptnavigation"
>
	{#each HANDY_ZIELE as platz (platz)}
		{#if platz === 'kamera' || platz === 'datei'}
			{@const kamera = platz === 'kamera'}
			<!-- Die Eingabe steckt im <label>: ein Tipp irgendwo auf den Platz oeffnet sie.
			     `sr-only` statt `hidden`, damit sie per Tastatur erreichbar bleibt; der
			     Fokusring sitzt am runden Knopf. `capture` erzwingt die Kamera und blendet die
			     Galerie aus — beides in einem Feld geht nicht, daher zwei Eingaben. -->
			<label
				class="group relative grid min-w-0 cursor-pointer justify-items-center pt-8 text-[11px] font-bold whitespace-nowrap text-tinte"
			>
				<span
					class="absolute -top-6 grid h-[52px] w-[52px] place-items-center rounded-full shadow-[0_8px_20px_rgba(7,174,183,.30),0_0_0_6px_var(--color-papier)] outline-offset-[8px] outline-marine group-has-[:focus-visible]:outline-2 {kamera
						? 'bg-tuerkis text-white'
						: 'border-2 border-tuerkis bg-papier text-tuerkis-dunkel'}"
					aria-hidden="true"
				>
					<Symbol name={platz} size={24} class="stroke-[2.1]" />
				</span>
				{kamera ? 'Kamera' : 'Datei'}
				{#if kamera}
					<input
						type="file"
						accept="image/*"
						capture="environment"
						class="sr-only"
						onchange={(e) => gewaehlt(e, 'camera')}
					/>
				{:else}
					<input
						type="file"
						accept="image/*"
						multiple
						class="sr-only"
						onchange={(e) => gewaehlt(e, 'upload')}
					/>
				{/if}
			</label>
		{:else}
			{@const seite = SEITEN.find((s) => s.id === platz)!}
			{@const ist = seite.id === aktiv}
			<a
				href={seite.weg}
				class="relative grid min-w-0 justify-items-center gap-0.5 pt-0.5 text-[11px] font-bold whitespace-nowrap"
				class:text-tuerkis-dunkel={ist}
				class:text-leise={!ist}
				aria-current={ist ? 'page' : undefined}
			>
				<Symbol name={seite.symbol} size={23} />
				{seite.titel}
				{#if seite.id === 'posteingang' && zaehler > 0}
					<b class="absolute top-0 left-[calc(50%+6px)] rounded-full bg-bernstein px-1.5 text-[10px] leading-4 text-white">{zaehler}</b>
				{/if}
			</a>
		{/if}
	{/each}
</nav>
