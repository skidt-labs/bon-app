<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * Der gemeinsame Kopf jeder Seite: Haushalt als Vorzeile, Titel, Untertitel, rechts
	 * eine Aktion (Snippet). Am Handy zusaetzlich das Nutzerkuerzel als Weg zu den
	 * Einstellungen — die liegen dort hinter dem Kuerzel, nicht in der Leiste unten
	 * (Runde 3, Variante III).
	 */
	let {
		titel,
		untertitel,
		haushalt = null,
		nutzer = null,
		aktion,
		children
	}: {
		titel: string;
		untertitel?: string;
		haushalt?: string | null;
		nutzer?: string | null;
		aktion?: Snippet;
		children: Snippet;
	} = $props();

	const kuerzel = $derived((nutzer ?? '').trim().charAt(0).toUpperCase() || '?');
</script>

<main class="mx-auto w-full max-w-md px-4 pt-5 pb-8 lg:max-w-6xl lg:px-8 lg:pt-7">
	<header class="mb-4 flex items-start justify-between gap-4">
		<div class="min-w-0">
			{#if haushalt}
				<p class="text-[11px] font-bold tracking-[0.08em] text-leise uppercase">{haushalt}</p>
			{/if}
			<h1 class="mt-1 text-[27px] font-extrabold tracking-tight lg:text-[26px]">{titel}</h1>
			{#if untertitel}<p class="mt-1 text-sm text-gedaempft">{untertitel}</p>{/if}
		</div>
		<div class="flex shrink-0 items-center gap-3">
			{@render aktion?.()}
			{#if nutzer}
				<a
					href="/settings/household"
					class="grid h-8 w-8 place-items-center rounded-full bg-chip text-[13px] font-extrabold text-gedaempft lg:hidden"
					aria-label="Einstellungen">{kuerzel}</a
				>
			{/if}
		</div>
	</header>
	{@render children()}
</main>
