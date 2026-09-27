<!-- src/lib/client/berichte/Aufklapper.svelte -->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { onMount } from 'svelte';
	import { afterNavigate } from '$app/navigation';
	import { menue } from './menue';

	/**
	 * Das eine Aufklappmenue der Berichtsseiten. Am Handy ein Blatt von unten mit
	 * abgedunkeltem Hintergrund (Tippen daneben, ✕ oder Escape schliessen), am Rechner ein
	 * Kasten unter dem Knopf. Immer nur eines ist offen (menue.ts), und nach einem
	 * Seitenwechsel — etwa nach einer Auswahl — schliesst es sich von selbst.
	 *
	 * Ohne JavaScript bleibt es ein gewoehnliches <details>: der Knopf klappt auf und zu.
	 */
	let {
		knopf,
		children,
		titel,
		knopfKlasse = '',
		klasse = 'relative',
		ausrichtung = 'links',
		breite = 'sm:w-[320px]',
		label
	}: {
		knopf: Snippet;
		children: Snippet;
		/** Kopf des Blatts am Handy */
		titel: string;
		knopfKlasse?: string;
		klasse?: string;
		ausrichtung?: 'links' | 'rechts' | 'mitte';
		breite?: string;
		label?: string;
	} = $props();

	let offen = $state(false);
	// Hintergrund und ✕ schliessen nur MIT JavaScript. Ohne JavaScript lagen sie ueber dem
	// Knopf, und das Menue liess sich nicht mehr zuklappen (Pruefung 27.09.2026) — deshalb
	// erscheinen sie erst nach dem Hydrieren; bis dahin klappt der Knopf selbst zu.
	let mitJs = $state(false);
	onMount(() => {
		mitJs = true;
	});
	afterNavigate(() => {
		offen = false;
	});

	const lage = $derived(
		ausrichtung === 'rechts' ? 'sm:right-0' : ausrichtung === 'mitte' ? 'sm:left-1/2 sm:-translate-x-1/2' : 'sm:left-0'
	);
</script>

<details class={klasse} bind:open={offen} use:menue>
	<summary class="cursor-pointer list-none [&::-webkit-details-marker]:hidden {knopfKlasse}" aria-label={label}>
		{@render knopf()}
	</summary>
	{#if mitJs}
		<!-- Nur am Handy: die Seite dahinter abdunkeln; Tippen darauf schliesst. -->
		<button
			type="button"
			class="fixed inset-0 z-40 cursor-default bg-tinte/40 sm:hidden"
			aria-hidden="true"
			tabindex="-1"
			onclick={() => (offen = false)}
		></button>
	{/if}
	<div
		class="fixed inset-x-0 bottom-0 z-50 max-h-[85dvh] overflow-y-auto overscroll-contain rounded-t-2xl bg-papier p-4 font-normal shadow-[0_-8px_30px_rgba(17,26,59,0.18)] sm:absolute sm:inset-x-auto sm:bottom-auto sm:top-full sm:mt-2 sm:max-h-[70vh] sm:rounded-2xl sm:p-3 sm:shadow-[0_8px_30px_rgba(17,26,59,0.18)] {breite} {lage}"
		role="dialog"
		aria-label={titel}
	>
		<div class="mb-3 flex min-h-11 items-center justify-between gap-3 sm:hidden">
			<b class="text-[15px] font-extrabold">{titel}</b>
			{#if mitJs}
				<button type="button" onclick={() => (offen = false)} aria-label="Schließen" class="grid h-11 w-11 place-items-center rounded-full border border-linie text-[15px]">✕</button>
			{/if}
		</div>
		{@render children()}
	</div>
</details>
