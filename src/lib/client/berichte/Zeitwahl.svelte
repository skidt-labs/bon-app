<script lang="ts">
	import type { BerichtFilter } from '$lib/berichte/filter';
	import { adresse, jahresAuswahl, zeitraumName, zeitwahlKacheln } from '$lib/berichte/zeitleiste';
	import { jahrVon, monatVon } from '$lib/berichte/kalender';
	import { formatCents } from '$lib/money';

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

	const z = $derived(filter.zeitraum);
	const laufendesJahr = $derived(jahrVon(heute));
	// Das Jahr der Kacheln. Blaettern geht nur hier drin (Knoepfe, kein Link); ohne
	// JavaScript bleibt es beim Jahr des Zeitraums — die Kacheln selbst sind Links.
	let angezeigt = $state<number | null>(null);
	const jahr = $derived(
		angezeigt ?? (z.art === 'jahr' ? z.jahr : jahrVon(z.art === 'monat' ? `${z.monat}-01` : z.bis))
	);
	const kacheln = $derived(zeitwahlKacheln(jahr, heute, monatsSummen));
	const link = (f: BerichtFilter) => adresse(pfad, f, zusatz);
	let offen = $state(false);
</script>

<!-- <details> statt eigenem Aufklappen: funktioniert ohne JavaScript, Tastatur inklusive.
     Am Handy ist der Inhalt ein Blatt von unten, am Rechner ein Feld unter dem Knopf. -->
<details class="relative min-w-0" bind:open={offen}>
	<summary
		class="flex h-11 cursor-pointer list-none items-center justify-center gap-1.5 rounded-full bg-tinte px-3 text-white [&::-webkit-details-marker]:hidden"
		aria-label="Zeitraum wählen: {zeitraumName(z)}"
	>
		<span class="truncate whitespace-nowrap tabular-nums">{zeitraumName(z)}</span>
		<span aria-hidden="true">▾</span>
	</summary>
	<div
		class="fixed inset-x-0 bottom-0 z-40 max-h-[80vh] overflow-y-auto rounded-t-2xl bg-papier p-4 font-normal shadow-[0_-8px_30px_rgba(17,26,59,0.18)] sm:absolute sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-full sm:mt-2 sm:w-[320px] sm:-translate-x-1/2 sm:rounded-2xl sm:shadow-[0_8px_30px_rgba(17,26,59,0.18)]"
	>
		{#if z.art === 'spanne'}
			<form method="GET" action={pfad} class="grid gap-3 text-[13px]">
				<input type="hidden" name="zeitraum" value="spanne" />
				{#if filter.umfang === 'meine'}<input type="hidden" name="umfang" value="meine" />{/if}
				{#if filter.laden.length > 0}<input type="hidden" name="laden" value={filter.laden.join(',')} />{/if}
				{#if filter.kategorie.length > 0}<input type="hidden" name="kategorie" value={filter.kategorie.join(',')} />{/if}
				{#each Object.entries(zusatz) as [name, wert] (name)}<input type="hidden" {name} value={wert} />{/each}
				<label class="grid gap-1 font-bold">
					Von
					<input type="date" name="von" value={z.von} max={heute} required class="rounded-xl border border-linie px-3 py-2 font-normal" />
				</label>
				<label class="grid gap-1 font-bold">
					Bis
					<input type="date" name="bis" value={z.bis} max={heute} required class="rounded-xl border border-linie px-3 py-2 font-normal" />
				</label>
				<button class="rounded-full bg-tinte px-4 py-2.5 font-bold text-white">Anzeigen</button>
				<p class="text-[12px] text-gedaempft">Höchstens drei Jahre am Stück, nicht in die Zukunft.</p>
			</form>
		{:else if z.art === 'jahr'}
			<ul class="grid grid-cols-3 gap-2 text-[13px] font-bold">
				{#each jahresAuswahl(heute, monatsSummen) as j (j)}
					{@const aktiv = z.art === 'jahr' && z.jahr === j}
					<li>
						<a
							href={link({ ...filter, zeitraum: { art: 'jahr', jahr: j } })}
							aria-current={aktiv ? 'page' : undefined}
							class="block rounded-xl border border-linie px-3 py-2.5 text-center tabular-nums"
							class:bg-tinte={aktiv}
							class:text-white={aktiv}>{j}</a
						>
					</li>
				{/each}
			</ul>
		{:else}
			<div class="mb-3 flex items-center justify-between text-[13px] font-bold">
				<button type="button" onclick={() => (angezeigt = jahr - 1)} aria-label="Jahr {jahr - 1}" class="h-9 w-9 rounded-full border border-linie">‹</button>
				<span class="tabular-nums">{jahr}</span>
				<button
					type="button"
					onclick={() => (angezeigt = jahr + 1)}
					disabled={jahr >= laufendesJahr}
					aria-label="Jahr {jahr + 1}"
					class="h-9 w-9 rounded-full border border-linie disabled:opacity-30">›</button
				>
			</div>
			<ul class="grid grid-cols-3 gap-2 text-[12.5px]">
				{#each kacheln as kachel (kachel.monat)}
					{@const aktiv = z.art === 'monat' && z.monat === kachel.monat}
					<li>
						{#if kachel.gesperrt}
							<span class="block rounded-xl border border-dashed border-linie px-2 py-2 text-center text-leise" aria-disabled="true">
								<b class="block">{kachel.kurz}</b>—
							</span>
						{:else}
							<a
								href={link({ ...filter, zeitraum: { art: 'monat', monat: kachel.monat } })}
								aria-current={aktiv ? 'page' : undefined}
								class="block rounded-xl border border-linie px-2 py-2 text-center"
								class:bg-tinte={aktiv}
								class:text-white={aktiv}
							>
								<b class="block">{kachel.kurz}</b>
								<span class="tabular-nums">{kachel.cents === null ? '—' : `${formatCents(kachel.cents)} €`}</span>
							</a>
						{/if}
					</li>
				{/each}
			</ul>
			<div class="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[13px] font-semibold text-tuerkis-dunkel">
				<a href={link({ ...filter, zeitraum: { art: 'monat', monat: monatVon(heute) } })}>Laufender Monat</a>
				<a href={link({ ...filter, zeitraum: { art: 'jahr', jahr } })}>Ganzes Jahr {jahr}</a>
			</div>
		{/if}
		<button type="button" class="mt-3 w-full rounded-full border border-linie py-2 text-[13px] font-bold sm:hidden" onclick={() => (offen = false)}>
			Schließen
		</button>
	</div>
</details>
