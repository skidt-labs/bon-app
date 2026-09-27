<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { formatCents } from '$lib/money';
	import { hatFilter, wirktAufPositionen } from '$lib/berichte/filter';
	import { filterZusammenfassung } from '$lib/berichte/merkmale';
	import { adresse, vergleichText, zeitraumName } from '$lib/berichte/zeitleiste';
	import { monatsName, tagName } from '$lib/berichte/kalender';

	let { data } = $props();

	const k = $derived(data.kennzahlen);
	const name = $derived(zeitraumName(data.filter.zeitraum));
	const zurueck = $derived(adresse('/reports', data.filter));

	// Der Druckdialog oeffnet von selbst; mit ?nichtdrucken bleibt es bei der Ansicht.
	onMount(() => {
		if (!page.url.searchParams.has('nichtdrucken')) window.print();
	});

	const TABELLE = 'mt-2 w-full border-collapse text-left';
	const ZELLE = 'border-b border-gray-300 py-1 pr-2 align-top';
	const BETRAG = 'border-b border-gray-300 py-1 text-right tabular-nums';
</script>

<svelte:head><title>Bericht {name} — {data.haushalt}</title></svelte:head>

<main class="mx-auto max-w-[190mm] bg-white p-6 text-[11pt] text-black print:max-w-none print:p-0">
	<div class="mb-4 flex flex-wrap gap-3 text-[13px] font-bold print:hidden">
		<button type="button" onclick={() => window.print()} class="rounded-full bg-black px-4 py-2 text-white">Drucken / als PDF speichern</button>
		<a href={zurueck} class="rounded-full border border-black px-4 py-2">‹ Zurück zum Bericht</a>
	</div>

	<header class="border-b-2 border-black pb-2">
		<h1 class="text-[18pt] font-extrabold">Bericht — {name}</h1>
		<p>{data.haushalt} · {data.filter.umfang === 'meine' ? 'Nur meine Bons' : 'Ganzer Haushalt'}</p>
		<p>{hatFilter(data.filter) ? filterZusammenfassung(data.filter, data.namen).join(' · ') : 'Ohne Filter'}</p>
	</header>

	{#each data.hinweise as hinweis (hinweis)}
		<p class="mt-2 border border-black px-2 py-1 text-[10pt]">Hinweis: {hinweis}</p>
	{/each}

	{#if k.bons === 0}
		<p class="mt-6 font-bold">Für {name} gibt es keinen passenden bestätigten Bon.</p>
	{:else}
		<section class="mt-4 break-inside-avoid">
			<h2 class="text-[13pt] font-bold">Kennzahlen</h2>
			<table class={TABELLE}>
				<tbody>
					<tr><td class={ZELLE}>Ausgaben ({wirktAufPositionen(data.filter) ? 'Summe der passenden Positionen' : 'Summe der Bons'})</td><td class={BETRAG}>{formatCents(k.summe)} €</td></tr>
					<tr><td class={ZELLE}>Bons</td><td class={BETRAG}>{k.bons}</td></tr>
					{#if k.positionen !== null}<tr><td class={ZELLE}>Passende Positionen</td><td class={BETRAG}>{k.positionen}</td></tr>{/if}
					<tr><td class={ZELLE}>Je Bon</td><td class={BETRAG}>{formatCents(k.schnitt)} €</td></tr>
					{#each data.vergleiche as v (v.bezeichnung)}
						<tr><td class={ZELLE} colspan="2">{vergleichText(v)}</td></tr>
					{/each}
				</tbody>
			</table>
		</section>

		<section class="mt-4 break-inside-avoid">
			<h2 class="text-[13pt] font-bold">Verlauf</h2>
			<table class={TABELLE}>
				<thead><tr><th class={ZELLE}>Monat</th><th class={BETRAG}>Betrag</th>{#if data.filter.zeitraum.art === 'jahr'}<th class={BETRAG}>Vorjahr</th>{/if}</tr></thead>
				<tbody>
					{#each data.verlauf as v (v.monat)}
						<tr>
							<td class={ZELLE}>{monatsName(v.monat)}</td>
							<td class={BETRAG}>{v.offen ? 'noch offen' : `${formatCents(v.cents)} €`}</td>
							{#if data.filter.zeitraum.art === 'jahr'}<td class={BETRAG}>{v.vorjahrCents === null ? '—' : `${formatCents(v.vorjahrCents)} €`}</td>{/if}
						</tr>
					{/each}
				</tbody>
			</table>
		</section>

		<section class="mt-4">
			<h2 class="text-[13pt] font-bold">Nach Kategorie</h2>
			<table class={TABELLE}>
				<tbody>
					{#each data.kategorien as p (p.id ?? 'unsortiert')}
						<tr class="break-inside-avoid"><td class="{ZELLE} font-bold">{p.name}</td><td class={BETRAG}>{formatCents(p.cents)} € · {Math.round(p.anteil * 100)} %</td></tr>
						{#each p.kinder as kind (kind.id)}
							<tr><td class="{ZELLE} pl-5">{kind.name}</td><td class={BETRAG}>{formatCents(kind.cents)} €</td></tr>
						{/each}
					{/each}
				</tbody>
			</table>
		</section>

		<section class="mt-4">
			<h2 class="text-[13pt] font-bold">Nach Händler</h2>
			<table class={TABELLE}>
				<tbody>
					{#each data.haendler as h (h.id ?? `name:${h.name}`)}
						<tr class="break-inside-avoid"><td class={ZELLE}>{h.name}</td><td class={BETRAG}>{formatCents(h.cents)} € · {Math.round(h.anteil * 100)} %</td></tr>
					{/each}
				</tbody>
			</table>
		</section>

		<section class="mt-4 break-inside-avoid">
			<h2 class="text-[13pt] font-bold">Budgets</h2>
			{#if data.budgets.art === 'keine'}
				<p class="mt-1">{data.budgets.grund}</p>
			{:else if data.budgets.liste.length === 0}
				<p class="mt-1">Kein Topf angelegt.</p>
			{:else if data.budgets.art === 'jahr'}
				<table class={TABELLE}>
					<tbody>
						{#each data.budgets.liste as b (b.budgetId)}
							<tr><td class={ZELLE}>{b.name}</td><td class={BETRAG}>{b.monateMitBetrag === 0 ? 'kein Betrag festgelegt' : `im Rahmen in ${b.monateImRahmen} von ${b.monateMitBetrag}`}</td></tr>
						{/each}
					</tbody>
				</table>
			{:else}
				<table class={TABELLE}>
					<tbody>
						{#each data.budgets.liste as b (b.budgetId)}
							<tr>
								<td class={ZELLE}>{b.name}</td>
								<td class={BETRAG}>
									{formatCents(b.ausgabeCents)} €{b.betragCents === null ? ' · kein Betrag festgelegt' : ` von ${formatCents(b.betragCents)} €`}{#if b.anteil !== null}&nbsp;({Math.round(b.anteil * 100)} %{b.anteil > 1 ? ', überschritten' : ''}){/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
		</section>
	{/if}

	<footer class="mt-6 border-t border-black pt-2 text-[9pt]">
		Nur bestätigte Bons · erstellt am {tagName(data.heute)}{#if data.rueckstand.bons > 0}&nbsp;· nicht enthalten: {data.rueckstand.bons} ungeprüfte {data.rueckstand.bons === 1 ? 'Bon' : 'Bons'}{/if}
	</footer>
</main>

<style>
	@page {
		size: A4;
		margin: 15mm;
	}
</style>
