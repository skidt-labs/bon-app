<script lang="ts">
	import Seite from '$lib/client/geruest/Seite.svelte';
	import Zeitleiste from '$lib/client/berichte/Zeitleiste.svelte';
	import { formatCents } from '$lib/money';
	import { adresse, leerText, monatImZeitraum, vergleichText, zeitraumName } from '$lib/berichte/zeitleiste';
	import { monatsKurz, monatsName } from '$lib/berichte/kalender';
	import type { BerichtFilter } from '$lib/berichte/filter';

	let { data } = $props();

	const name = $derived(zeitraumName(data.filter.zeitraum));
	const k = $derived(data.kennzahlen);
	const leer = $derived(k.bons === 0);
	const leerHinweis = $derived(leerText(data.filter));
	const zeitraum = $derived(data.filter.zeitraum);

	/** Der groesste Balken gibt den Massstab — sonst sagt die Laenge nichts. */
	const maxKategorie = $derived(Math.max(1, ...data.kategorien.map((x) => Math.abs(x.cents))));
	const maxHaendler = $derived(Math.max(1, ...data.haendler.map((x) => Math.abs(x.cents))));
	const maxVerlauf = $derived(Math.max(1, ...data.verlauf.flatMap((x) => [x.cents, x.vorjahrCents ?? 0])));

	const bonsLink = (zusatz: Partial<BerichtFilter>) =>
		adresse('/reports/bons', { ...data.filter, laden: [], kategorie: [], ...zusatz });
	const monatLink = (monat: string) => adresse('/reports', { ...data.filter, zeitraum: { art: 'monat', monat } });

	const UEBERSCHRIFT = 'text-[10.5px] font-bold tracking-[0.08em] text-gedaempft uppercase';
	const KARTE = 'rounded-2xl bg-papier px-5 py-4 shadow-[0_0_0_1px_var(--color-linie)]';
</script>

<Seite titel="Berichte" untertitel={name} haushalt={data.haushalt} nutzer={data.user?.displayName ?? null}>
	{#snippet aktion()}
		{#if zeitraum.art === 'monat'}
			<a href="/reports/export.csv?monat={zeitraum.monat}" class="hidden rounded-xl border border-linie bg-papier px-4 py-2.5 text-sm font-bold lg:inline-block">CSV</a>
		{/if}
	{/snippet}

	<Zeitleiste filter={data.filter} heute={data.heute} pfad="/reports" monatsSummen={data.monatsSummen} />

	{#each data.hinweise as hinweis (hinweis)}
		<p class="mb-3 rounded-xl bg-bernstein-flaeche px-3.5 py-2.5 text-[13px] font-semibold text-bernstein">{hinweis}</p>
	{/each}

	{#if leer}
		<div class="rounded-2xl bg-papier px-5 py-10 text-center shadow-[0_0_0_1px_var(--color-linie)]">
			<p class="text-[15px] font-bold">{leerHinweis.text}</p>
			<p class="mt-1 text-sm text-gedaempft">Ein Bericht zeigt nur geprüfte Bons — alles andere wäre geraten.</p>
			{#if leerHinweis.zurueck}
				<p class="mt-3 text-sm">
					<a href={adresse('/reports', leerHinweis.zurueck.filter)} class="font-semibold text-tuerkis-dunkel">{leerHinweis.zurueck.text} ›</a>
				</p>
			{/if}
			{#if data.rueckstand.bons > 0}
				<p class="mt-3 text-sm">
					<a href="/inbox?status=brauchtDich" class="font-semibold text-tuerkis-dunkel"
						>{data.rueckstand.bons} ungeprüfte Bons über {formatCents(data.rueckstand.cent)} € prüfen ›</a
					>
				</p>
			{/if}
		</div>
	{:else}
		<!-- ============ Kennzahlen ============ -->
		<div class="grid gap-3 sm:grid-cols-3">
			<div class={KARTE}>
				<span class={UEBERSCHRIFT}>Ausgaben</span>
				<b class="mt-0.5 block text-[30px] leading-none font-extrabold tabular-nums">{formatCents(k.summe)} €</b>
				<!-- Vergleiche mit Vorzeichen UND Wort; die Farbe ist nur Zugabe. -->
				{#each data.vergleiche as v (v.bezeichnung)}
					<p
						class="mt-1.5 text-[12.5px] text-gedaempft"
						class:text-rot-dunkel={v.prozent !== null && v.prozent > 0}
						class:text-tuerkis-dunkel={v.prozent !== null && v.prozent < 0}
					>
						{vergleichText(v)}
					</p>
				{/each}
			</div>
			<div class={KARTE}>
				<span class={UEBERSCHRIFT}>Bons</span>
				<b class="mt-0.5 block text-[30px] leading-none font-extrabold tabular-nums">{k.bons}</b>
				{#if data.ohneBetrag > 0}
					<p class="mt-1.5 text-[12.5px] text-bernstein">{data.ohneBetrag} ohne erkannte Endsumme</p>
				{/if}
			</div>
			<div class={KARTE}>
				<span class={UEBERSCHRIFT}>Je Bon</span>
				<b class="mt-0.5 block text-[30px] leading-none font-extrabold tabular-nums">{formatCents(k.schnitt)} €</b>
			</div>
		</div>

		<!-- Der Vorbehalt steht direkt unter den Zahlen: eine Summe ist nur so wahr, wie
		     wenig ungeprueft danebenliegt. -->
		{#if data.rueckstand.bons > 0 || data.differenzCents !== 0}
			<div class="mt-3 rounded-xl bg-bernstein-flaeche px-3.5 py-2.5 text-[12.5px] font-semibold text-bernstein">
				{#if data.rueckstand.bons > 0}
					<p>
						Nicht in diesen Zahlen: {data.rueckstand.bons} ungeprüfte
						{data.rueckstand.bons === 1 ? 'Bon' : 'Bons'} über {formatCents(data.rueckstand.cent)} € —
						<a href="/inbox?status=brauchtDich" class="underline">jetzt prüfen</a>
					</p>
				{/if}
				{#if data.differenzCents !== 0}
					<p class:mt-1={data.rueckstand.bons > 0}>
						Die Positionen ergeben {data.differenzCents > 0 ? '+' : ''}{formatCents(data.differenzCents)} € gegenüber
						den gedruckten Endsummen. Die Aufschlüsselung unten rechnet mit den Positionen.
					</p>
				{/if}
			</div>
		{/if}

		<!-- ============ Verlauf ============ -->
		<section class="mt-6 {KARTE}">
			<h2 class={UEBERSCHRIFT}>Verlauf — bestätigte Ausgaben</h2>
			<ol class="mt-3 flex items-end gap-1.5">
				{#each data.verlauf as v (v.monat)}
					{@const aktiv = monatImZeitraum(v.monat, zeitraum)}
					<li class="min-w-0 flex-1">
						{#if v.offen}
							<span class="flex flex-col items-center gap-1.5 text-leise" title="{monatsName(v.monat)} — noch offen">
								<span class="hidden text-[10.5px] sm:block">offen</span>
								<span class="relative block h-[84px] w-full">
									<span class="absolute inset-x-0 bottom-0 border-t border-dashed border-linie"></span>
								</span>
								<span class="text-[11px] font-semibold">{monatsKurz(v.monat)}</span>
							</span>
						{:else}
							<a
								href={monatLink(v.monat)}
								aria-label="{monatsName(v.monat)}: {formatCents(v.cents)} €"
								class="flex flex-col items-center gap-1.5 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tuerkis"
							>
								<span class="hidden text-[10.5px] font-bold tabular-nums sm:block" class:text-tinte={aktiv} class:text-leise={!aktiv}>
									{v.cents === 0 ? '—' : formatCents(v.cents)}
								</span>
								<span class="relative block h-[84px] w-full">
									<!-- Ein Monat ohne Ausgaben bekommt eine sichtbare Grundlinie: „null
									     Euro" und „nicht gemessen" sehen sonst gleich aus. -->
									<span
										class="absolute inset-x-0 bottom-0 block rounded-t-[4px]"
										class:bg-tuerkis={aktiv}
										class:bg-linie-hell={!aktiv}
										style="height: {v.cents === 0 ? 2 : Math.max(4, (v.cents / maxVerlauf) * 84)}px"
									></span>
									{#if v.vorjahrCents !== null}
										<span
											class="absolute left-1/2 block h-2 w-2 -translate-x-1/2 rounded-full bg-marine ring-2 ring-papier"
											style="bottom: {Math.max(0, (v.vorjahrCents / maxVerlauf) * 84 - 4)}px"
											title="Vorjahr: {formatCents(v.vorjahrCents)} €"
										></span>
									{/if}
								</span>
								<span class="text-[11px] font-semibold" class:text-tinte={aktiv} class:text-leise={!aktiv}>{monatsKurz(v.monat)}</span>
							</a>
						{/if}
					</li>
				{/each}
			</ol>
			{#if zeitraum.art === 'jahr'}
				<p class="mt-2 text-[11.5px] text-gedaempft">
					<span class="mr-1 inline-block h-2 w-2 rounded-full bg-marine align-middle"></span>Punkt = derselbe Monat im Vorjahr
				</p>
			{/if}
		</section>

		<div class="mt-4 grid gap-4 lg:grid-cols-2">
			<!-- ============ Kategorien ============ -->
			<section class={KARTE}>
				<h2 class={UEBERSCHRIFT}>Nach Kategorie</h2>
				<ul class="mt-3 grid gap-2.5">
					{#each data.kategorien as p (p.id ?? 'unsortiert')}
						<li class="flex items-start gap-3">
							<!-- Aufklappen mit <details>: ohne JavaScript, mit Tastatur. -->
							<details class="min-w-0 flex-1">
								<summary class="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
									<div class="flex items-baseline justify-between gap-3 text-[13px]">
										<span class="truncate font-bold" class:text-gedaempft={p.id === null}>{p.name}</span>
										<span class="shrink-0 tabular-nums">
											<b>{formatCents(p.cents)} €</b>
											<span class="ml-1 text-gedaempft">{Math.round(p.anteil * 100)} %</span>
										</span>
									</div>
									<div class="mt-1 h-1.5 rounded-full bg-chip" aria-hidden="true">
										<div
											class="h-full rounded-full"
											class:bg-tuerkis={p.id !== null}
											class:bg-leise={p.id === null}
											style="width: {Math.max(2, (Math.abs(p.cents) / maxKategorie) * 100)}%"
										></div>
									</div>
								</summary>
								{#if p.kinder.length > 0}
									<ul class="mt-1.5 grid gap-1 pl-3 text-[12px] text-gedaempft">
										{#each p.kinder as kind (kind.id)}
											<li class="flex justify-between gap-3">
												{#if kind.slug}
													<a href={bonsLink({ kategorie: [kind.slug] })} class="truncate underline-offset-2 hover:underline">{kind.name}</a>
												{:else}
													<span class="truncate">{kind.name}</span>
												{/if}
												<span class="shrink-0 tabular-nums">{formatCents(kind.cents)} €</span>
											</li>
										{/each}
									</ul>
								{:else}
									<p class="mt-1.5 pl-3 text-[12px] text-gedaempft">Keine Unterkategorien in diesem Zeitraum.</p>
								{/if}
							</details>
							{#if p.slug}
								<a href={bonsLink({ kategorie: [p.slug] })} class="shrink-0 text-[12.5px] font-semibold whitespace-nowrap text-tuerkis-dunkel">Bons ›</a>
							{/if}
						</li>
					{/each}
				</ul>
			</section>

			<!-- ============ Händler ============ -->
			<section class={KARTE}>
				<h2 class={UEBERSCHRIFT}>Nach Händler</h2>
				<ul class="mt-3 grid gap-2.5">
					{#each data.haendler as h (h.id ?? `name:${h.name}`)}
						<li class="flex items-start gap-3">
							<div class="min-w-0 flex-1">
								<div class="flex items-baseline justify-between gap-3 text-[13px]">
									<span class="truncate font-bold">{h.name}</span>
									<span class="shrink-0 tabular-nums">
										<b>{formatCents(h.cents)} €</b>
										<span class="ml-1 text-gedaempft">{Math.round(h.anteil * 100)} %</span>
									</span>
								</div>
								<div class="mt-1 h-1.5 rounded-full bg-chip" aria-hidden="true">
									<div class="h-full rounded-full bg-marine" style="width: {Math.max(2, (Math.abs(h.cents) / maxHaendler) * 100)}%"></div>
								</div>
							</div>
							{#if h.id}
								<a href={bonsLink({ laden: [h.id] })} class="shrink-0 text-[12.5px] font-semibold whitespace-nowrap text-tuerkis-dunkel">Bons ›</a>
							{:else}
								<span class="w-[42px] shrink-0" aria-hidden="true"></span>
							{/if}
						</li>
					{/each}
				</ul>
			</section>
		</div>

		<!-- ============ Budgets ============ -->
		<section class="mt-4 {KARTE}">
			<h2 class={UEBERSCHRIFT}>Budgets</h2>
			{#if data.budgets.art === 'keine'}
				<p class="mt-1.5 text-[13px] text-gedaempft">{data.budgets.grund}</p>
			{:else if data.budgets.liste.length === 0}
				<p class="mt-1.5 text-[13px] text-gedaempft">
					Noch kein Topf angelegt —
					<a href="/settings/budgets" class="font-semibold text-tuerkis-dunkel">Budgets einrichten</a>.
				</p>
			{:else if data.budgets.art === 'jahr'}
				<ul class="mt-3 grid gap-2">
					{#each data.budgets.liste as b (b.budgetId)}
						<li class="flex items-baseline justify-between gap-3 text-[13px]">
							<span class="truncate font-bold">{b.name}</span>
							<span class="shrink-0 text-gedaempft">
								{b.monateMitBetrag === 0
									? 'kein Betrag festgelegt'
									: `im Rahmen in ${b.monateImRahmen} von ${b.monateMitBetrag} ${b.monateMitBetrag === 1 ? 'Monat' : 'Monaten'}`}
							</span>
						</li>
					{/each}
				</ul>
			{:else}
				<ul class="mt-3 grid gap-3">
					{#each data.budgets.liste as b (b.budgetId)}
						{@const ueber = b.anteil !== null && b.anteil > 1}
						<li>
							<div class="flex items-baseline justify-between gap-3 text-[13px]">
								<span class="truncate font-bold">{b.name}</span>
								<span class="shrink-0 tabular-nums">
									<b>{formatCents(b.ausgabeCents)} €</b>
									<span class="text-gedaempft">{b.betragCents === null ? ' · kein Betrag festgelegt' : ` von ${formatCents(b.betragCents)} €`}</span>
								</span>
							</div>
							{#if b.anteil !== null}
								<div class="mt-1 h-2 rounded-full bg-chip" aria-hidden="true">
									<div class="h-full rounded-full" class:bg-rot={ueber} class:bg-tuerkis={!ueber} style="width: {Math.min(100, b.anteil * 100)}%"></div>
								</div>
								<!-- Der Zustand steht als TEXT da, nicht nur als Farbe. -->
								<p class="mt-0.5 text-[11.5px] font-semibold" class:text-rot-dunkel={ueber} class:text-gedaempft={!ueber}>
									{Math.round(b.anteil * 100)} % {ueber ? '— überschritten' : 'verbraucht'}
								</p>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		{#if zeitraum.art === 'monat'}
			<p class="mt-4 text-[12.5px] lg:hidden">
				<a href="/reports/export.csv?monat={zeitraum.monat}" class="font-semibold text-tuerkis-dunkel">Als CSV herunterladen ›</a>
			</p>
		{/if}
	{/if}
</Seite>
