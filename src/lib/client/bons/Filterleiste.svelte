<script lang="ts">
	import { page } from '$app/state';
	import { filterLink } from '$lib/bons/anzeige';
	import Symbol from '$lib/client/geruest/Symbol.svelte';
	import type { ListenFilter, StatusFilter, Zaehler } from '$lib/server/bons/liste';

	let {
		filter,
		zaehler,
		mitMonat,
		hinweise
	}: { filter: ListenFilter; zaehler: Zaehler; mitMonat: boolean; hinweise: string[] } = $props();

	const chips: { id: StatusFilter; text: string; n: number | null }[] = $derived([
		{ id: 'brauchtDich', text: 'Braucht dich', n: zaehler.brauchtDich },
		{ id: 'wirdGelesen', text: 'Wird gelesen', n: zaehler.wirdGelesen },
		{ id: 'fehlgeschlagen', text: 'Fehlgeschlagen', n: zaehler.fehlgeschlagen },
		{ id: 'bestaetigt', text: 'Bestätigt', n: zaehler.bestaetigt },
		{ id: 'alle', text: 'Alle', n: null }
	]);
</script>

<!-- Status als Links (kein JavaScript noetig), Monat und Suche als Formular mit GET —
     die URL traegt den Zustand, ein Neuladen zeigt denselben Filter. -->
<div class="mb-4 flex flex-col gap-3">
	<div class="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-wrap lg:px-0">
		{#each chips as c (c.id)}
			{@const aktiv = filter.status === c.id}
			<a
				href={filterLink(page.url.searchParams, { status: c.id })}
				class="shrink-0 rounded-full border px-3 py-1.5 text-[13px] font-bold whitespace-nowrap"
				class:bg-tinte={aktiv}
				class:text-white={aktiv}
				class:border-tinte={aktiv}
				class:bg-papier={!aktiv}
				class:text-gedaempft={!aktiv}
				class:border-linie={!aktiv}
				aria-current={aktiv ? 'true' : undefined}
			>
				{c.text}{#if c.n !== null}<span class="ml-1 font-extrabold">{c.n}</span>{/if}
			</a>
		{/each}
	</div>

	<form method="GET" class="flex flex-wrap items-center gap-2">
		<input type="hidden" name="status" value={filter.status} />
		{#if mitMonat}
			<label class="flex items-center gap-2 rounded-xl border border-linie bg-papier px-3 py-1.5 text-[13px] font-bold text-gedaempft">
				Monat
				<input id="filter-monat" type="month" name="monat" value={filter.monat ?? ''} class="bg-transparent font-semibold text-tinte outline-none" />
			</label>
		{/if}
		<label class="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-linie bg-papier px-3 py-1.5 text-[13px] lg:max-w-sm">
			<Symbol name="suche" size={15} class="shrink-0 text-leise" />
			<input
				id="filter-suche"
				type="search"
				name="suche"
				value={filter.suche ?? ''}
				placeholder="Händler, Artikel …"
				class="min-w-0 flex-1 bg-transparent font-semibold text-tinte outline-none placeholder:text-leise"
			/>
		</label>
		<button type="submit" class="rounded-xl bg-chip px-3 py-1.5 text-[13px] font-bold text-gedaempft">Filtern</button>
		{#if filter.suche || filter.haendler || (mitMonat && filter.monat)}
			<a
				href={filterLink(page.url.searchParams, { suche: null, haendler: null, monat: mitMonat ? '' : null })}
				class="text-[13px] font-bold text-tuerkis-dunkel">Zurücksetzen</a
			>
		{/if}
	</form>

	{#each hinweise as h}
		<p class="rounded-xl bg-bernstein-flaeche px-3 py-2 text-sm text-bernstein">{h}</p>
	{/each}
</div>
