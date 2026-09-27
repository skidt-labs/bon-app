<script lang="ts">
	import { formatCents } from '$lib/money';
	import { adresse } from '$lib/berichte/zeitleiste';
	import { merkmalParameter, ohneMerkmal, zeitraumParameter, type BerichtFilter, type Merkmal } from '$lib/berichte/filter';
	import { MERKMAL_NAME, type FilterOption } from '$lib/berichte/merkmale';

	let {
		filter,
		wahl,
		optionen,
		pfad,
		zusatz = {}
	}: {
		filter: BerichtFilter;
		wahl: Merkmal;
		optionen: FilterOption[] | null;
		pfad: string;
		zusatz?: Record<string, string>;
	} = $props();

	// Alles Uebrige reist als verstecktes Feld mit — das Formular aendert nur dieses Merkmal.
	const behalten = $derived({ ...zeitraumParameter(filter.zeitraum), ...merkmalParameter(ohneMerkmal(filter, wahl)), ...zusatz });
	const schliessen = $derived(adresse(pfad, filter, zusatz));
	const leeren = $derived(adresse(pfad, ohneMerkmal(filter, wahl), zusatz));

	let suche = $state('');
	let angehakt = $state<number | null>(null);
	const anzahl = $derived(angehakt ?? optionen?.filter((o) => o.gewaehlt).length ?? 0);
	// Nicht passende Eintraege werden nur AUSGEBLENDET, nicht entfernt: ein entferntes
	// Kontrollkaestchen wird nicht mitgeschickt, und ein vorher angehakter Laden verschwand
	// still aus dem Filter (Abschlusspruefung Stufe 2).
	const passt = (o: FilterOption) => o.name.toLocaleLowerCase('de').includes(suche.trim().toLocaleLowerCase('de'));
	const keinTreffer = $derived((optionen ?? []).length > 0 && !(optionen ?? []).some(passt));
	const euro = (c: number | null | undefined) => (c === null || c === undefined ? '' : (c / 100).toFixed(2).replace('.', ','));
	const SICHTEN = [
		{ wert: '', name: 'Geteilte und eigene private' },
		{ wert: 'geteilt', name: 'Nur geteilte' },
		{ wert: 'privat', name: 'Nur eigene private' }
	];
	const feld = 'rounded-xl border border-linie px-3 py-2 font-normal';
</script>

<!-- Nur am Handy: Seite abdunkeln; Tippen daneben schliesst (derselbe Link wie ✕). -->
<a href={schliessen} class="fixed inset-0 z-40 bg-tinte/40 sm:hidden" aria-hidden="true" tabindex="-1"></a>
<section
	class="fixed inset-x-0 bottom-0 z-50 max-h-[85dvh] overflow-y-auto overscroll-contain rounded-t-2xl bg-papier p-4 shadow-[0_-8px_30px_rgba(17,26,59,0.18)] sm:static sm:mb-4 sm:max-h-none sm:rounded-2xl sm:shadow-[0_0_0_1px_var(--color-linie)]"
	aria-label="Filter {MERKMAL_NAME[wahl]}"
>
	<div class="mb-3 flex items-center justify-between">
		<h2 class="text-[15px] font-extrabold">Filter: {MERKMAL_NAME[wahl]}</h2>
		<a href={schliessen} aria-label="Schließen" class="grid h-11 w-11 place-items-center rounded-full border border-linie text-[15px]">✕</a>
	</div>
	<form
		method="GET"
		action={pfad}
		class="grid gap-3 text-[13px]"
		onchange={(e) => (angehakt = e.currentTarget.querySelectorAll('input[type=checkbox]:checked').length)}
	>
		{#each Object.entries(behalten) as [name, wert] (name)}<input type="hidden" {name} value={wert} />{/each}

		{#if optionen}
			<input type="search" bind:value={suche} placeholder="{MERKMAL_NAME[wahl]} suchen" class={feld} />
			<ul class="grid max-h-[50vh] gap-1 overflow-y-auto sm:max-h-80">
				{#each optionen as o (o.wert)}
					<li hidden={!passt(o)}>
						<label class="flex cursor-pointer items-center gap-3 rounded-xl px-2 py-2 hover:bg-chip" class:pl-7={o.ebene === 1}>
							<input type="checkbox" name={wahl} value={o.wert} checked={o.gewaehlt} class="h-4 w-4 shrink-0" />
							<span class="min-w-0 flex-1 truncate font-bold">{o.name}</span>
							<span class="shrink-0 text-[12px] text-gedaempft tabular-nums">{formatCents(o.cents)} € · {o.bons} {o.bons === 1 ? 'Bon' : 'Bons'}</span>
						</label>
					</li>
				{:else}
					<li class="px-2 py-2 text-gedaempft">Im gewählten Zeitraum gibt es dazu nichts.</li>
				{/each}
				{#if keinTreffer}
					<li class="px-2 py-2 text-gedaempft">Kein Eintrag passt zu „{suche.trim()}".</li>
				{/if}
			</ul>
			<p class="text-[12px] text-gedaempft">Mehrere angehakt = einer davon (ODER). Beträge und Bons: im gewählten Zeitraum, mit den übrigen Filtern.</p>
			<div class="flex flex-wrap items-center gap-3">
				<button class="rounded-full bg-tinte px-4 py-2.5 font-bold text-white">{anzahl === 0 ? 'Anwenden' : `${anzahl} anwenden`}</button>
				<a href={leeren} class="font-semibold text-tuerkis-dunkel">Auswahl leeren</a>
			</div>
		{:else if wahl === 'betrag'}
			<p class="text-gedaempft">Gilt für den Betrag des ganzen Bons. Bons ohne erkannte Endsumme fallen heraus.</p>
			<div class="grid grid-cols-2 gap-3">
				<label class="grid gap-1 font-bold">Ab (€)<input name="betrag_ab" inputmode="decimal" value={euro(filter.betrag?.ab)} class={feld} /></label>
				<label class="grid gap-1 font-bold">Bis (€)<input name="betrag_bis" inputmode="decimal" value={euro(filter.betrag?.bis)} class={feld} /></label>
			</div>
			<button class="justify-self-start rounded-full bg-tinte px-4 py-2.5 font-bold text-white">Anwenden</button>
		{:else if wahl === 'suche'}
			<label class="grid gap-1 font-bold">
				Artikel enthält
				<input type="search" name="suche" value={filter.suche ?? ''} maxlength="100" placeholder="z. B. Kaffee" class={feld} />
			</label>
			<p class="text-gedaempft">Ohne Groß/Klein und Akzente. Ein Rabatt auf einen gefundenen Artikel wird abgezogen.</p>
			<button class="justify-self-start rounded-full bg-tinte px-4 py-2.5 font-bold text-white">Anwenden</button>
		{:else}
			<fieldset class="grid gap-2">
				<legend class="mb-1 font-bold">Welche Bons?</legend>
				{#each SICHTEN as s (s.wert)}
					<label class="flex items-center gap-2">
						<input type="radio" name="sicht" value={s.wert} checked={(filter.sicht ?? '') === s.wert} />
						{s.name}
					</label>
				{/each}
			</fieldset>
			<p class="text-gedaempft">Private Bons anderer siehst du nie — „privat" heißt: nur deine eigenen.</p>
			<button class="justify-self-start rounded-full bg-tinte px-4 py-2.5 font-bold text-white">Anwenden</button>
		{/if}
	</form>
</section>
