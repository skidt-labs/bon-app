<script lang="ts">
	import Seite from '$lib/client/geruest/Seite.svelte';
	import { formatCents } from '$lib/money';

	let { data } = $props();

	const name = (m: string) =>
		new Date(`${m}-01T12:00:00Z`).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
	const kurz = (m: string) =>
		new Date(`${m}-01T12:00:00Z`).toLocaleDateString('de-DE', { month: 'short' });

	const monatsName = $derived(name(data.monat));
	const k = $derived(data.kennzahlen);

	/** Der groesste Balken gibt den Massstab — sonst sagt die Laenge nichts. */
	const maxKategorie = $derived(Math.max(1, ...data.kategorien.map((x) => Math.abs(x.cents))));
	const maxHaendler = $derived(Math.max(1, ...data.haendler.map((x) => Math.abs(x.cents))));
	const maxVerlauf = $derived(Math.max(1, ...data.verlauf.map((x) => x.cents)));

	const leer = $derived(k.bons === 0);
</script>

<Seite
	titel="Berichte"
	untertitel={monatsName}
	haushalt={data.haushalt}
	nutzer={data.user?.displayName ?? null}
>
	{#snippet aktion()}
		<a
			href="/reports/export.csv?monat={data.monat}"
			class="hidden rounded-xl border border-linie bg-papier px-4 py-2.5 text-sm font-bold lg:inline-block"
			>CSV</a
		>
	{/snippet}

	<!-- Monatswahl: Vormonat und Folgemonat (Server rechnet sie, siehe monatsNachbarn).
	     Drei FESTE Felder, damit beim Blaettern nichts springt: die Pfeile tragen nur das
	     Symbol (der Zielmonat steht im aria-label), der Monat hat eine feste Breite, und
	     ein fehlender Pfeil (laufender Monat) laesst seinen Platz stehen, statt dass die
	     Zeile nachrueckt. Vorher wuchs der Knopf mit dem Monatsnamen — „Mai" gegen
	     „September" — und die Pfeile wanderten mit. -->
	<nav
		class="mb-4 grid grid-cols-[44px_1fr_44px] items-center gap-2 text-[13px] font-bold sm:grid-cols-[44px_200px_44px]"
		aria-label="Monat wählen"
	>
		{#if data.nachbarn.zurueck}
			<a
				href="/reports?monat={data.nachbarn.zurueck}"
				aria-label="Vormonat: {name(data.nachbarn.zurueck)}"
				title={name(data.nachbarn.zurueck)}
				class="flex h-11 w-11 items-center justify-center rounded-full border border-linie bg-papier text-lg"
				>‹</a
			>
		{:else}
			<span class="h-11 w-11" aria-hidden="true"></span>
		{/if}
		<span
			class="truncate rounded-full bg-tinte px-3 py-2.5 text-center whitespace-nowrap text-white tabular-nums"
			aria-current="page">{monatsName}</span
		>
		{#if data.nachbarn.vor}
			<a
				href="/reports?monat={data.nachbarn.vor}"
				aria-label="Folgemonat: {name(data.nachbarn.vor)}"
				title={name(data.nachbarn.vor)}
				class="flex h-11 w-11 items-center justify-center rounded-full border border-linie bg-papier text-lg"
				>›</a
			>
		{:else}
			<span class="h-11 w-11" aria-hidden="true"></span>
		{/if}
	</nav>

	{#if data.hinweis}
		<p class="mb-3 rounded-xl bg-bernstein-flaeche px-3.5 py-2.5 text-[13px] font-semibold text-bernstein">
			{data.hinweis}
		</p>
	{/if}

	{#if leer}
		<div class="rounded-2xl bg-papier px-5 py-10 text-center shadow-[0_0_0_1px_var(--color-linie)]">
			<p class="text-[15px] font-bold">Für {monatsName} ist noch kein Bon bestätigt.</p>
			<p class="mt-1 text-sm text-gedaempft">
				Ein Bericht zeigt nur geprüfte Bons — alles andere wäre geraten.
			</p>
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
			<div class="rounded-2xl bg-papier px-5 py-4 shadow-[0_0_0_1px_var(--color-linie)] sm:col-span-1">
				<span class="text-[10.5px] font-bold tracking-[0.08em] text-leise uppercase">Ausgaben</span>
				<b class="mt-0.5 block text-[30px] leading-none font-extrabold tabular-nums"
					>{formatCents(k.summe)} €</b
				>
				<p class="mt-1.5 text-[12.5px] text-gedaempft">
					{#if k.veraenderungProzent === null}
						Kein Vergleich zum Vormonat
					{:else}
						<span class:text-rot-dunkel={k.veraenderungProzent > 0} class:text-tuerkis-dunkel={k.veraenderungProzent <= 0}>
							{k.veraenderungProzent > 0 ? '+' : ''}{k.veraenderungProzent} %
						</span>
						gegenüber {formatCents(k.vormonatCents ?? 0)} €
					{/if}
				</p>
			</div>
			<div class="rounded-2xl bg-papier px-5 py-4 shadow-[0_0_0_1px_var(--color-linie)]">
				<span class="text-[10.5px] font-bold tracking-[0.08em] text-leise uppercase">Bons</span>
				<b class="mt-0.5 block text-[30px] leading-none font-extrabold tabular-nums">{k.bons}</b>
				{#if data.ohneBetrag > 0}
					<p class="mt-1.5 text-[12.5px] text-bernstein">
						{data.ohneBetrag} ohne erkannte Endsumme
					</p>
				{/if}
			</div>
			<div class="rounded-2xl bg-papier px-5 py-4 shadow-[0_0_0_1px_var(--color-linie)]">
				<span class="text-[10.5px] font-bold tracking-[0.08em] text-leise uppercase">Je Bon</span>
				<b class="mt-0.5 block text-[30px] leading-none font-extrabold tabular-nums"
					>{formatCents(k.schnitt)} €</b
				>
			</div>
		</div>

		<!-- Der Vorbehalt steht direkt unter den Zahlen, nicht am Seitenende: eine
		     Monatssumme ist nur so wahr, wie wenig ungeprueft danebenliegt. -->
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
						Die Positionen ergeben {data.differenzCents > 0 ? '+' : ''}{formatCents(data.differenzCents)} €
						gegenüber den gedruckten Endsummen. Die Aufschlüsselung unten rechnet mit den Positionen.
					</p>
				{/if}
			</div>
		{/if}

		<!-- ============ Verlauf ============ -->
		<section class="mt-6 rounded-2xl bg-papier px-5 py-4 shadow-[0_0_0_1px_var(--color-linie)]">
			<h2 class="text-[10.5px] font-bold tracking-[0.08em] text-leise uppercase">
				Verlauf — bestätigte Ausgaben
			</h2>
			<ol class="mt-3 flex items-end gap-2" style="height: 120px">
				{#each data.verlauf as v (v.monat)}
					{@const aktiv = v.monat === data.monat}
					<li class="flex h-full flex-1 flex-col justify-end gap-1.5 text-center">
						<span class="text-[11px] font-bold tabular-nums" class:text-tinte={aktiv} class:text-leise={!aktiv}>
							{v.cents === 0 ? '—' : formatCents(v.cents)}
						</span>
						<!-- Ein Monat ohne Ausgaben bekommt eine sichtbare Grundlinie statt gar
						     nichts: „null Euro" und „nicht gemessen" sehen sonst gleich aus. -->
						<span
							class="block rounded-t-[4px]"
							class:bg-tuerkis={aktiv}
							class:bg-linie-hell={!aktiv}
							style="height: {v.cents === 0 ? 2 : Math.max(4, (v.cents / maxVerlauf) * 78)}px"
							aria-hidden="true"
						></span>
						<span class="text-[11px] font-semibold" class:text-tinte={aktiv} class:text-leise={!aktiv}
							>{kurz(v.monat)}</span
						>
					</li>
				{/each}
			</ol>
		</section>

		<div class="mt-4 grid gap-4 lg:grid-cols-2">
			<!-- ============ Kategorien ============ -->
			<section class="rounded-2xl bg-papier px-5 py-4 shadow-[0_0_0_1px_var(--color-linie)]">
				<h2 class="text-[10.5px] font-bold tracking-[0.08em] text-leise uppercase">Nach Kategorie</h2>
				<ul class="mt-3 grid gap-2.5">
					{#each data.kategorien as p (p.id ?? 'unsortiert')}
						<li>
							<div class="flex items-baseline justify-between gap-3 text-[13px]">
								<span class="truncate font-bold" class:text-gedaempft={p.id === null}>{p.name}</span>
								<span class="shrink-0 tabular-nums">
									<b>{formatCents(p.cents)} €</b>
									<span class="ml-1 text-leise">{Math.round(p.anteil * 100)} %</span>
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
							{#if p.kinder.length > 1}
								<ul class="mt-1 grid gap-0.5 pl-3 text-[12px] text-gedaempft">
									{#each p.kinder as kind (kind.id)}
										<li class="flex justify-between gap-3">
											<span class="truncate">{kind.name}</span>
											<span class="shrink-0 tabular-nums">{formatCents(kind.cents)} €</span>
										</li>
									{/each}
								</ul>
							{/if}
						</li>
					{/each}
				</ul>
			</section>

			<!-- ============ Händler ============ -->
			<section class="rounded-2xl bg-papier px-5 py-4 shadow-[0_0_0_1px_var(--color-linie)]">
				<h2 class="text-[10.5px] font-bold tracking-[0.08em] text-leise uppercase">Nach Händler</h2>
				<ul class="mt-3 grid gap-2.5">
					{#each data.haendler as h (h.name)}
						<li>
							<div class="flex items-baseline justify-between gap-3 text-[13px]">
								<span class="truncate font-bold">{h.name}</span>
								<span class="shrink-0 tabular-nums">
									<b>{formatCents(h.cents)} €</b>
									<span class="ml-1 text-leise">{Math.round(h.anteil * 100)} %</span>
								</span>
							</div>
							<div class="mt-1 h-1.5 rounded-full bg-chip" aria-hidden="true">
								<div
									class="h-full rounded-full bg-marine"
									style="width: {Math.max(2, (Math.abs(h.cents) / maxHaendler) * 100)}%"
								></div>
							</div>
						</li>
					{/each}
				</ul>
			</section>
		</div>

		<!-- ============ Budgets ============ -->
		<section class="mt-4 rounded-2xl bg-papier px-5 py-4 shadow-[0_0_0_1px_var(--color-linie)]">
			<h2 class="text-[10.5px] font-bold tracking-[0.08em] text-leise uppercase">Budgets</h2>
			{#if data.budgets.length === 0}
				<p class="mt-1.5 text-[13px] text-gedaempft">
					Noch kein Topf angelegt —
					<a href="/settings/budgets" class="font-semibold text-tuerkis-dunkel">Budgets einrichten</a>.
				</p>
			{:else}
				<ul class="mt-3 grid gap-3">
					{#each data.budgets as b (b.budgetId)}
						{@const ueber = b.anteil !== null && b.anteil > 1}
						<li>
							<div class="flex items-baseline justify-between gap-3 text-[13px]">
								<span class="truncate font-bold">{b.name}</span>
								<span class="shrink-0 tabular-nums">
									<b>{formatCents(b.ausgabeCents)} €</b>
									<span class="text-leise">
										{b.betragCents === null ? ' · kein Betrag festgelegt' : ` von ${formatCents(b.betragCents)} €`}
									</span>
								</span>
							</div>
							{#if b.anteil !== null}
								<div class="mt-1 h-2 rounded-full bg-chip" aria-hidden="true">
									<div
										class="h-full rounded-full"
										class:bg-rot={ueber}
										class:bg-tuerkis={!ueber}
										style="width: {Math.min(100, b.anteil * 100)}%"
									></div>
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

		<p class="mt-4 text-[12.5px] lg:hidden">
			<a href="/reports/export.csv?monat={data.monat}" class="font-semibold text-tuerkis-dunkel"
				>Als CSV herunterladen ›</a
			>
		</p>
	{/if}
</Seite>
