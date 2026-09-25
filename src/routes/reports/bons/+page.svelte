<script lang="ts">
	import Seite from '$lib/client/geruest/Seite.svelte';
	import Zeitleiste from '$lib/client/berichte/Zeitleiste.svelte';
	import { adresse, zeitraumName } from '$lib/berichte/zeitleiste';
	import { tagName } from '$lib/berichte/kalender';
	import { formatCents } from '$lib/money';

	let { data } = $props();

	const liste = $derived(data.liste);
	// Vom Server, nicht aus der Adresse: eine unbekannte Kategorie filtert nicht.
	const nachKategorie = $derived(data.liste?.nachKategorie ?? false);
	const zusatz = $derived<Record<string, string>>(data.ansicht === 'position' ? { ansicht: 'position' } : {});
	const zumBericht = $derived(adresse('/reports', { ...data.filter, laden: [], kategorie: [] }));
	const ansichtLink = (a: 'bon' | 'position') =>
		adresse('/reports/bons', data.filter, a === 'position' ? { ansicht: 'position' } : {});
	const kategorieLink = (slug: string) => adresse('/reports/bons', { ...data.filter, kategorie: [slug] }, zusatz);
	const positionen = $derived(
		liste
			? liste.bons.flatMap((b) =>
					b.passende.map((p, i) => ({ ...p, schluessel: `${b.id}-${i}`, bonId: b.id, tag: b.tag, haendler: b.haendler }))
				)
			: []
	);
	const ANSICHTEN = [
		{ a: 'bon', name: 'Nach Bon' },
		{ a: 'position', name: 'Nach Position' }
	] as const;
	const KARTE = 'rounded-2xl bg-papier shadow-[0_0_0_1px_var(--color-linie)]';
</script>

<Seite
	titel={liste?.titel ? `Bons zu ${liste.titel}` : 'Bons'}
	untertitel={zeitraumName(data.filter.zeitraum)}
	haushalt={data.haushalt}
	nutzer={data.user?.displayName ?? null}
>
	<p class="mb-3 text-[13px]"><a href={zumBericht} class="font-semibold text-tuerkis-dunkel">‹ Zum Bericht</a></p>

	<Zeitleiste filter={data.filter} heute={data.heute} pfad="/reports/bons" monatsSummen={data.monatsSummen} {zusatz} />

	{#each data.hinweise as hinweis (hinweis)}
		<p class="mb-3 rounded-xl bg-bernstein-flaeche px-3.5 py-2.5 text-[13px] font-semibold text-bernstein">{hinweis}</p>
	{/each}

	{#if liste}
		{#if liste.oberkategorie}
			<p class="mb-3 text-[13px]">
				<a href={kategorieLink(liste.oberkategorie.slug)} class="font-semibold text-tuerkis-dunkel">Alles in {liste.oberkategorie.name} ›</a>
			</p>
		{/if}
		{#if liste.unterkategorien.length > 0}
			<nav aria-label="Unterkategorien" class="mb-3 flex flex-wrap gap-2 text-[12.5px] font-bold">
				<span class="rounded-full bg-tinte px-3 py-1.5 text-white" aria-current="page">Alle</span>
				{#each liste.unterkategorien as u (u.slug)}
					<a href={kategorieLink(u.slug)} class="rounded-full border border-linie bg-papier px-3 py-1.5">
						{u.name} <span class="font-semibold text-gedaempft tabular-nums">{formatCents(u.cents)} €</span>
					</a>
				{/each}
			</nav>
		{/if}

		<div class="mb-3 flex flex-wrap items-center justify-between gap-2">
			<p class="text-[13px]">
				<b class="tabular-nums">{formatCents(liste.summe)} €</b>
				in {liste.bons.length} {liste.bons.length === 1 ? 'Bon' : 'Bons'}{#if nachKategorie}&nbsp;· {liste.positionen}
					{liste.positionen === 1 ? 'Position' : 'Positionen'}{/if}
				{#if liste.ohneBetrag > 0}
					<span class="text-bernstein">&nbsp;· {liste.ohneBetrag} ohne erkannte Endsumme</span>
				{/if}
			</p>
			<nav aria-label="Ansicht" class="inline-flex rounded-full border border-linie bg-papier p-0.5 text-[13px] font-bold">
				{#each ANSICHTEN as o (o.a)}
					{@const aktiv = data.ansicht === o.a}
					<a href={ansichtLink(o.a)} aria-current={aktiv ? 'page' : undefined} class="rounded-full px-3 py-1.5" class:bg-tinte={aktiv} class:text-white={aktiv}>{o.name}</a>
				{/each}
			</nav>
		</div>

		{#if liste.bons.length === 0}
			<div class="{KARTE} px-5 py-10 text-center">
				<p class="text-[15px] font-bold">Dazu gibt es im gewählten Zeitraum keinen bestätigten Bon.</p>
			</div>
		{:else if data.ansicht === 'bon'}
			<ul class="grid gap-2">
				{#each liste.bons as b (b.id)}
					<li>
						<a href="/receipts/{b.id}" class="{KARTE} flex items-center justify-between gap-3 px-4 py-3">
							<span class="min-w-0">
								<b class="block truncate text-[13.5px]">{b.haendler ?? 'Unbekannter Händler'}</b>
								<span class="text-[12px] text-gedaempft">
									{tagName(b.tag)}{#if nachKategorie}&nbsp;· {b.passende.length} {b.passende.length === 1 ? 'Position' : 'Positionen'}{/if}
								</span>
								{#if b.privat}<span class="ml-1.5 rounded-full bg-chip px-2 py-0.5 text-[10.5px] font-bold">privat</span>{/if}
							</span>
							<span class="shrink-0 text-right tabular-nums">
								<b class="block text-[13.5px]">{b.passendCents === null ? '—' : `${formatCents(b.passendCents)} €`}</b>
								{#if nachKategorie}
									<span class="text-[11.5px] text-gedaempft">von {b.gesamtCents === null ? '—' : `${formatCents(b.gesamtCents)} €`}</span>
								{/if}
							</span>
						</a>
					</li>
				{/each}
			</ul>
		{:else}
			<ul class="grid gap-1.5">
				{#each positionen as p (p.schluessel)}
					<li>
						<a href="/receipts/{p.bonId}" class="{KARTE} flex items-center justify-between gap-3 px-4 py-2.5">
							<span class="min-w-0">
								<b class="block truncate text-[13px]">{p.rawText}</b>
								<span class="text-[11.5px] text-gedaempft">{tagName(p.tag)} · {p.haendler ?? 'Unbekannter Händler'}{#if p.kategorie}&nbsp;· {p.kategorie}{/if}</span>
							</span>
							<b class="shrink-0 text-[13px] tabular-nums">{formatCents(p.cents)} €</b>
						</a>
					</li>
				{/each}
			</ul>
		{/if}
	{/if}
</Seite>
