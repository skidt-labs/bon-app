<script lang="ts">
	import { adresse } from '$lib/berichte/zeitleiste';
	import { MERKMALE, ohneFilter, ohneMerkmal, type BerichtFilter } from '$lib/berichte/filter';
	import { aktiveMerkmale, merkmalText, MERKMAL_NAME, type FilterNamen } from '$lib/berichte/merkmale';
	import Aufklapper from './Aufklapper.svelte';

	let {
		filter,
		namen,
		pfad,
		zusatz = {},
		mitAuswahl = true
	}: {
		filter: BerichtFilter;
		namen: FilterNamen;
		pfad: string;
		zusatz?: Record<string, string>;
		mitAuswahl?: boolean;
	} = $props();

	const aktiv = $derived(aktiveMerkmale(filter));
	const link = (f: BerichtFilter, extra: Record<string, string> = {}) => adresse(pfad, f, { ...zusatz, ...extra });
</script>

<!-- Fest direkt unter der Zeitleiste. Am Rechner brechen die Chips um, am Handy scrollen
     sie waagerecht — die Zeile selbst wandert nicht. -->
<div class="mb-4 flex items-center gap-2 overflow-x-auto pb-1 text-[12.5px] font-bold sm:flex-wrap sm:overflow-visible" role="group" aria-label="Filter">
	{#each aktiv as m (m)}
		<span class="flex shrink-0 items-center gap-1.5 rounded-full bg-tinte py-1 pr-1 pl-3 whitespace-nowrap text-white">
			{merkmalText(filter, m, namen)}
			<a href={link(ohneMerkmal(filter, m))} aria-label="Filter {MERKMAL_NAME[m]} entfernen" class="flex h-7 w-7 items-center justify-center rounded-full bg-white/15">✕</a>
		</span>
	{/each}
	{#if mitAuswahl}
		<!-- Am Handy ein Blatt von unten (fixed): die waagerecht scrollende Zeile wuerde ein
		     absolut gesetztes Menue abschneiden. -->
		<Aufklapper
			titel="Filter hinzufügen"
			klasse="relative shrink-0"
			breite="sm:w-52"
			knopfKlasse="block rounded-full border border-linie bg-papier px-3 py-1.5 whitespace-nowrap"
		>
			{#snippet knopf()}+ Filter{/snippet}
			<ul class="grid gap-0.5 font-semibold">
				{#each MERKMALE as m (m)}
					<li>
						<a href={link(filter, { wahl: m })} class="flex min-h-11 items-center justify-between gap-3 rounded-lg px-3 py-2.5 hover:bg-chip">
							<span>{MERKMAL_NAME[m]}</span>
							{#if aktiv.includes(m)}<span class="truncate text-[12px] font-semibold text-gedaempft">gesetzt</span>{/if}
						</a>
					</li>
				{/each}
			</ul>
		</Aufklapper>
	{/if}
	{#if aktiv.length > 0}
		<a href={link(ohneFilter(filter))} class="shrink-0 px-2 py-1.5 whitespace-nowrap text-tuerkis-dunkel">Alle entfernen</a>
	{/if}
</div>
