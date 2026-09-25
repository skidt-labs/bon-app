<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import Seite from '$lib/client/geruest/Seite.svelte';
	import Einstellungsleiste from '$lib/client/geruest/Einstellungsleiste.svelte';
	import Betragsfeld from '$lib/client/pruefen/Betragsfeld.svelte';
	import { formatCents } from '$lib/money';

	let { data } = $props();

	const monatsName = $derived(
		new Date(`${data.monat}-01T12:00:00Z`).toLocaleDateString('de-DE', {
			month: 'long',
			year: 'numeric'
		})
	);
	const nameJeKategorie = $derived(new Map(data.kategorien.map((k) => [k.id, k.name])));
	/** Je Kategorie der Topf, der sie in diesem Monat hat — fuer den ausgegrauten Baum. */
	const topfJeKategorie = $derived(
		new Map(data.budgets.flatMap((b) => b.kategorieIds.map((k) => [k, b.name] as const)))
	);

	let gewaehlt = $state<string | null>(null);
	let busy = $state(false);
	let meldung = $state('');
	let neuerName = $state('');
	// Vorgabe aus: der Normalfall ist der gemeinsame Topf. Ein Mitglied kann nur private
	// anlegen — fuer es steht der Schalter fest auf an, weil alles andere einen Knopf
	// anboete, den der Server ablehnt.
	let neuPrivat = $state(false);

	const topf = $derived(data.budgets.find((b) => b.budgetId === gewaehlt) ?? null);

	/**
	 * Der Betrag im Feld, bevor er abgeschickt wird. Eine eigene Zustandsgroesse, an die
	 * das Betragsfeld gebunden ist — den Wert beim Klick aus dem DOM zu fischen waere
	 * brueckig und still falsch, sobald sich das Feld aendert.
	 *
	 * Wechselt die Auswahl oder kommen neue Daten vom Server, faellt das Feld zurueck auf
	 * den gespeicherten Betrag.
	 */
	let betragEntwurf = $state<number | null>(null);
	let betragUngueltig = $state(false);
	$effect(() => {
		betragEntwurf = topf?.betragCents ?? null;
		betragUngueltig = false;
	});

	async function ruf(pfad: string, art: string, rumpf?: unknown) {
		busy = true;
		meldung = '';
		try {
			const res = await fetch(pfad, {
				method: art,
				headers: rumpf ? { 'content-type': 'application/json' } : undefined,
				body: rumpf ? JSON.stringify(rumpf) : undefined
			});
			if (!res.ok) {
				const text = await res.text().catch(() => '');
				let satz = `Nicht gespeichert (HTTP ${res.status}).`;
				try {
					const j = JSON.parse(text) as { message?: string };
					if (j.message) satz = j.message;
				} catch {
					/* kein JSON — der Statussatz bleibt */
				}
				meldung = satz;
				return null;
			}
			await invalidateAll();
			return (await res.json().catch(() => ({}))) as Record<string, unknown>;
		} catch {
			meldung = 'Keine Verbindung — bitte später noch einmal versuchen.';
			return null;
		} finally {
			busy = false;
		}
	}

	async function anlegen() {
		const name = neuerName.trim();
		if (!name) return;
		const antwort = await ruf('/api/budgets', 'POST', {
			name,
			privat: data.istVerwalter ? neuPrivat : true
		});
		if (antwort && typeof antwort.id === 'string') gewaehlt = antwort.id;
		neuerName = '';
		neuPrivat = false;
	}

	const aendern = (id: string, aenderung: unknown) => ruf(`/api/budgets/${id}`, 'PATCH', aenderung);
</script>

<Seite
	titel="Budgets"
	untertitel="{data.budgets.length} {data.budgets.length === 1 ? 'Topf' : 'Töpfe'} · {monatsName}"
	haushalt={data.haushalt}
	nutzer={data.user?.displayName ?? null}
>
	<Einstellungsleiste aktiv="budgets" />

	{#if data.hinweis}
		<p class="mb-3 rounded-xl bg-bernstein-flaeche px-3.5 py-2.5 text-[13px] font-semibold text-bernstein">
			{data.hinweis}
		</p>
	{/if}

	<!-- Warum hier keine Balken stehen: ein Balken braucht Ausgaben je Kategorie, und die
	     rechnet erst Etappe 6. Solange kaum eine Position kategorisiert ist, waere jeder
	     Balken ohnehin eine Behauptung — der Grund ist nuetzlicher als ein leerer Balken. -->
	<p class="mb-4 rounded-xl bg-chip px-3.5 py-2.5 text-[13px] text-gedaempft">
		{#if data.positionen.gesamt === 0}
			Noch keine Positionen erfasst — Verbrauchsbalken erscheinen, sobald Bons bestätigt sind.
		{:else if data.positionen.mitKategorie === 0}
			Von {data.positionen.gesamt} Positionen hat noch keine eine Kategorie. Bis dahin lässt sich kein
			Verbrauch je Topf zeigen.
		{:else}
			{data.positionen.mitKategorie} von {data.positionen.gesamt} Positionen haben eine Kategorie. Der
			Verbrauch je Topf kommt mit den Berichten.
		{/if}
	</p>

	<div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
		<!-- ============ Links: die Töpfe ============ -->
		<section class="grid content-start gap-2">
			{#each data.budgets as b (b.budgetId)}
				<button
					type="button"
					class="rounded-2xl bg-papier px-4 py-3 text-left shadow-[0_0_0_1px_var(--color-linie)]"
					class:shadow-[0_0_0_2px_var(--color-tuerkis)]={b.budgetId === gewaehlt}
					onclick={() => (gewaehlt = b.budgetId)}
				>
					<span class="flex items-baseline justify-between gap-3">
						<b class="truncate text-[15px] font-extrabold">{b.name}</b>
						<span class="shrink-0 text-[14px] font-bold tabular-nums">
							{b.betragCents !== null ? `${formatCents(b.betragCents)} €` : '— €'}
						</span>
					</span>
					<span class="mt-0.5 block text-[12.5px] text-gedaempft">
						{b.kategorieIds.length}
						{b.kategorieIds.length === 1 ? 'Kategorie' : 'Kategorien'}
						{#if b.betragCents === null}· kein Betrag für {monatsName}{/if}
					</span>
				</button>
			{/each}

			<div class="rounded-2xl bg-papier px-4 py-3 shadow-[0_0_0_1px_var(--color-linie)]">
				<span class="text-[10.5px] font-bold tracking-[0.08em] text-leise uppercase"
					>Außerhalb aller Budgets</span
				>
				<p class="mt-1 text-[12.5px] text-gedaempft">
					{#if data.ausserhalb.length === 0}
						Jede Kategorie gehört zu einem Topf.
					{:else}
						{data.ausserhalb.length} von {data.kategorien.length} Kategorien:
						{data.ausserhalb
							.map((id) => nameJeKategorie.get(id))
							.filter(Boolean)
							.slice(0, 8)
							.join(' · ')}{data.ausserhalb.length > 8 ? ' …' : ''}
					{/if}
				</p>
			</div>

			{#if !data.istVerwalter}
				<!--
					Erklaeren statt ausgrauen. Ein Mitglied sieht die gemeinsamen Toepfe —
					es soll ja wissen, wie voll sie sind —, kann sie aber nicht aendern.
					Ein Knopf, der nichts tut, laesst den Menschen an sich zweifeln; ein
					Satz sagt ihm, wen er fragen muss.
				-->
				<p class="mt-1 rounded-xl bg-chip px-3.5 py-2.5 text-[12.5px] font-semibold leading-relaxed text-gedaempft">
					Gemeinsame Töpfe verwaltet die Person, die den Haushalt verwaltet. Deine eigenen
					Töpfe legst du hier an — die sieht nur du.
				</p>
			{/if}

			<div class="mt-1 flex gap-2">
				<input
					bind:value={neuerName}
					placeholder="Name des neuen Topfs"
					class="min-w-0 flex-1 rounded-xl border border-linie bg-papier px-3 py-2 text-sm font-semibold"
					onkeydown={(e) => e.key === 'Enter' && anlegen()}
				/>
				<button
					type="button"
					class="rounded-xl bg-tuerkis px-4 py-2 text-sm font-extrabold text-white disabled:opacity-60"
					disabled={busy || neuerName.trim() === ''}
					onclick={anlegen}>Anlegen</button
				>
			</div>

			{#if data.istVerwalter}
				<!-- Wie beim Bon: der Schalter steht vor dem Ergebnis, und darunter steht
				     im Klartext, was er bedeutet. -->
				<label class="mt-2 flex items-start gap-2.5">
					<input type="checkbox" bind:checked={neuPrivat} class="mt-0.5 h-4 w-4 shrink-0 accent-tuerkis" />
					<span class="min-w-0 text-[13px] leading-tight">
						<span class="block font-bold">nur für mich</span>
						<span class="block text-[11.5px] font-semibold text-leise">
							{neuPrivat
								? 'Der Topf und seine Ausgaben sind nur für dich sichtbar'
								: 'Der Topf gilt für den ganzen Haushalt'}
						</span>
					</span>
				</label>
			{/if}
		</section>

		<!-- ============ Rechts: der Editor ============ -->
		<section class="rounded-2xl bg-papier px-5 py-4 shadow-[0_0_0_1px_var(--color-linie)]">
			{#if !topf}
				<p class="py-8 text-center text-[13px] text-gedaempft">
					{data.budgets.length === 0
						? 'Noch kein Topf angelegt.'
						: 'Einen Topf auswählen, um ihn zu bearbeiten.'}
				</p>
			{:else}
				<!-- Am Handy lesend (Entwurf §7): das fieldset sperrt alle Felder auf einmal. -->
				<fieldset disabled={busy} class="contents">
					<label class="grid gap-1">
						<span class="text-[10.5px] font-bold tracking-[0.08em] text-leise uppercase">Name</span>
						<input
							value={topf.name}
							onblur={(e) =>
								e.currentTarget.value.trim() !== topf.name &&
								aendern(topf.budgetId, { art: 'umbenennen', name: e.currentTarget.value.trim() })}
							class="rounded-lg border border-linie bg-papier px-2.5 py-1.5 font-semibold"
						/>
					</label>

					<label class="mt-3 grid gap-1">
						<span class="text-[10.5px] font-bold tracking-[0.08em] text-leise uppercase"
							>Betrag ab {monatsName}</span
						>
						<Betragsfeld
							bind:cents={betragEntwurf}
							bind:ungueltig={betragUngueltig}
							leerErlaubt
							ariaLabel="Betrag des Topfs {topf.name}"
							class="px-2.5 py-1.5 font-bold"
						/>
						<button
							type="button"
							class="mt-1 justify-self-start rounded-lg border border-linie px-2.5 py-1 text-[12px] font-bold disabled:opacity-40"
							disabled={betragUngueltig || betragEntwurf === null || betragEntwurf === topf.betragCents}
							onclick={() =>
								betragEntwurf !== null &&
								aendern(topf.budgetId, {
									art: 'betrag',
									monat: data.monat,
									amountCents: betragEntwurf
								})}>Betrag ab {monatsName} festlegen</button
						>
					</label>

					<div class="mt-4">
						<span class="text-[10.5px] font-bold tracking-[0.08em] text-leise uppercase"
							>Kategorien in diesem Topf</span
						>
						<div class="mt-1.5 flex flex-wrap gap-1.5">
							{#each topf.kategorieIds as id (id)}
								<span
									class="flex items-center gap-1 rounded-full bg-tuerkis-flaeche px-2.5 py-1 text-[12px] font-bold text-tuerkis-dunkel"
								>
									{nameJeKategorie.get(id) ?? id}
									<button
										type="button"
										aria-label="{nameJeKategorie.get(id)} aus dem Topf lösen"
										onclick={() =>
											aendern(topf.budgetId, {
												art: 'loesen',
												categoryId: id,
												abMonat: data.monat
											})}>×</button
									>
								</span>
							{:else}
								<span class="text-[12.5px] text-gedaempft">Noch keine Kategorie zugeordnet.</span>
							{/each}
						</div>
					</div>

					<div class="mt-4">
						<span class="text-[10.5px] font-bold tracking-[0.08em] text-leise uppercase"
							>Hinzufügen</span
						>
						<!-- Vergebenes steht ausgegraut MIT dem Namen seines Topfs. Nur „nicht
						     verfügbar" liesse den Menschen suchen — bei 51 Kategorien ist das
						     der Unterschied zwischen einem Klick und einer Fahndung. -->
						<ul class="mt-1.5 grid max-h-72 gap-0.5 overflow-y-auto pr-1">
							{#each data.kategorien as k (k.id)}
								{@const belegtVon = topfJeKategorie.get(k.id)}
								{@const eigen = topf.kategorieIds.includes(k.id)}
								<li>
									<button
										type="button"
										class="w-full rounded-lg px-2 py-1 text-left text-[12.5px] disabled:cursor-not-allowed"
										class:pl-5={k.parentId !== null}
										class:font-bold={k.parentId === null}
										class:text-leise={belegtVon !== undefined}
										class:hover:bg-chip={belegtVon === undefined}
										disabled={belegtVon !== undefined}
										onclick={() =>
											aendern(topf.budgetId, {
												art: 'zuordnen',
												categoryId: k.id,
												abMonat: data.monat
											})}
									>
										{k.name}
										{#if eigen}
											<span class="text-tuerkis-dunkel">· in diesem Topf</span>
										{:else if belegtVon}
											<span>· in „{belegtVon}"</span>
										{/if}
									</button>
								</li>
							{/each}
						</ul>
					</div>

					<button
						type="button"
						class="mt-5 text-[12.5px] font-bold text-rot-dunkel"
						onclick={() => ruf(`/api/budgets/${topf.budgetId}?abMonat=${data.monat}`, 'DELETE')}
					>
						Topf ab {monatsName} löschen
					</button>
					<p class="mt-1 text-[11.5px] text-leise">
						Name und Beträge bleiben erhalten, damit vergangene Berichte unverändert bleiben.
					</p>
				</fieldset>
			{/if}
			{#if meldung}<p class="mt-3 text-sm font-semibold text-rot-dunkel">{meldung}</p>{/if}
		</section>
	</div>
</Seite>
