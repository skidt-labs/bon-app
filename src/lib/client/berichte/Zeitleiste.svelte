<script lang="ts">
	import Zeitwahl from './Zeitwahl.svelte';
	import type { BerichtFilter, Zeitraum } from '$lib/berichte/filter';
	import { adresse, blaetterZiele, wechsleArt, zeitraumName } from '$lib/berichte/zeitleiste';

	let {
		filter,
		heute,
		pfad,
		monatsSummen,
		zusatz = {}
	}: {
		filter: BerichtFilter;
		heute: string;
		pfad: string;
		monatsSummen: Record<string, number>;
		zusatz?: Record<string, string>;
	} = $props();

	const ARTEN: { art: Zeitraum['art']; name: string }[] = [
		{ art: 'monat', name: 'Monat' },
		{ art: 'jahr', name: 'Jahr' },
		{ art: 'spanne', name: 'Von–bis' }
	];
	const UMFAENGE: { umfang: BerichtFilter['umfang']; name: string }[] = [
		{ umfang: 'haushalt', name: 'Haushalt' },
		{ umfang: 'meine', name: 'Nur meine' }
	];

	const ziele = $derived(blaetterZiele(filter.zeitraum, heute));
	const link = (f: BerichtFilter) => adresse(pfad, f, zusatz);
	const pfeil = 'flex h-11 w-11 items-center justify-center rounded-full border border-linie bg-papier text-lg';
</script>

<div class="mb-4 grid gap-2.5">
	<div class="flex flex-wrap items-center gap-2 text-[13px] font-bold">
		<nav aria-label="Zeitraum-Art" class="inline-flex rounded-full border border-linie bg-papier p-0.5">
			{#each ARTEN as a (a.art)}
				{@const aktiv = filter.zeitraum.art === a.art}
				<a
					href={link({ ...filter, zeitraum: wechsleArt(filter.zeitraum, a.art, heute) })}
					aria-current={aktiv ? 'page' : undefined}
					class="rounded-full px-3 py-1.5 whitespace-nowrap"
					class:bg-tinte={aktiv}
					class:text-white={aktiv}>{a.name}</a
				>
			{/each}
		</nav>
		<nav aria-label="Umfang" class="inline-flex rounded-full border border-linie bg-papier p-0.5">
			{#each UMFAENGE as u (u.umfang)}
				{@const aktiv = filter.umfang === u.umfang}
				<a
					href={link({ ...filter, umfang: u.umfang })}
					aria-current={aktiv ? 'page' : undefined}
					class="rounded-full px-3 py-1.5 whitespace-nowrap"
					class:bg-tinte={aktiv}
					class:text-white={aktiv}>{u.name}</a
				>
			{/each}
		</nav>
	</div>

	<!-- Blaetterzeile: drei FESTE Felder (seit 0.3.2). Die Pfeile tragen nur das Symbol
	     (Ziel im aria-label), die Mitte hat feste Breite, ein fehlender „›" laesst seinen
	     Platz stehen — beim Blaettern verschiebt sich nichts. -->
	<nav aria-label="Blättern" class="grid grid-cols-[44px_1fr_44px] items-center gap-2 text-[13px] font-bold sm:grid-cols-[44px_240px_44px]">
		<a href={link({ ...filter, zeitraum: ziele.zurueck })} aria-label="Zurück: {zeitraumName(ziele.zurueck)}" title={zeitraumName(ziele.zurueck)} class={pfeil}>‹</a>
		{#key zeitraumName(filter.zeitraum)}
			<Zeitwahl {filter} {heute} {pfad} {monatsSummen} {zusatz} />
		{/key}
		{#if ziele.vor}
			<a href={link({ ...filter, zeitraum: ziele.vor })} aria-label="Weiter: {zeitraumName(ziele.vor)}" title={zeitraumName(ziele.vor)} class={pfeil}>›</a>
		{:else}
			<span class="h-11 w-11" aria-hidden="true"></span>
		{/if}
	</nav>
</div>
