<script lang="ts">
	import { adresse } from '$lib/berichte/zeitleiste';
	import { MERKMALE, ohneFilter, ohneMerkmal, type BerichtFilter } from '$lib/berichte/filter';
	import { aktiveMerkmale, merkmalText, MERKMAL_NAME, type FilterNamen } from '$lib/berichte/merkmale';

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
		<details class="shrink-0">
			<summary class="cursor-pointer list-none rounded-full border border-linie bg-papier px-3 py-1.5 whitespace-nowrap [&::-webkit-details-marker]:hidden">+ Filter</summary>
			<!-- fixed am Handy: die waagerecht scrollende Zeile wuerde ein absolut gesetztes Menue abschneiden. -->
			<ul class="fixed inset-x-4 bottom-4 z-40 grid gap-0.5 rounded-2xl bg-papier p-2 font-semibold shadow-[0_8px_30px_rgba(17,26,59,0.18)] sm:absolute sm:inset-x-auto sm:bottom-auto sm:mt-2 sm:w-52">
				{#each MERKMALE as m (m)}
					<li><a href={link(filter, { wahl: m })} class="block rounded-lg px-3 py-2 hover:bg-chip">{MERKMAL_NAME[m]}</a></li>
				{/each}
			</ul>
		</details>
	{/if}
	{#if aktiv.length > 0}
		<a href={link(ohneFilter(filter))} class="shrink-0 px-2 py-1.5 whitespace-nowrap text-tuerkis-dunkel">Alle entfernen</a>
	{/if}
</div>
