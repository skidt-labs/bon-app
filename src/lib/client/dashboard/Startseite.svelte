<script lang="ts">
	import type { Startseitendaten } from '$lib/server/dashboard/laden';
	import Seite from '$lib/client/geruest/Seite.svelte';
	import Symbol from '$lib/client/geruest/Symbol.svelte';
	import { formatCents } from '$lib/money';
	import { formatWann, statusText } from '$lib/bons/anzeige';
	import { describeProblem } from '$lib/bons/beanstandungen';

	// `data` kommt vom Loader der Seite, die diese Komponente zeigt — /dashboard und,
	// am Schreibtisch, die Eingangstuer /. Beide laden dasselbe (server/dashboard/laden.ts).
	let { data }: { data: Startseitendaten } = $props();

	const monatsName = $derived(
		new Date(`${data.monat}-01T12:00:00Z`).toLocaleDateString('de-DE', {
			month: 'long',
			year: 'numeric'
		})
	);

	const z = $derived(data.zaehler);
	const m = $derived(data.zahlen);

	/**
	 * Der Vergleich zum Vormonat — nur, wenn es dort etwas zu vergleichen GIBT. Ohne
	 * bestaetigte Bons im Vormonat waere jede Prozentzahl erfunden; dann steht hier
	 * nichts, und die Seite sagt warum.
	 */
	const vergleich = $derived.by(() => {
		if (!m.vormonat || m.vormonat.cent === 0) return null;
		const diff = m.bestaetigt.cent - m.vormonat.cent;
		const prozent = Math.round((diff / m.vormonat.cent) * 100);
		return { diff, prozent };
	});

	const untertitel = $derived(
		z.brauchtDich === 0
			? 'Nichts wartet auf dich.'
			: `${z.brauchtDich} ${z.brauchtDich === 1 ? 'Bon wartet' : 'Bons warten'} auf dich`
	);
</script>

<Seite titel="Start" {untertitel} haushalt={data.haushalt} nutzer={data.user?.displayName ?? null}>
	{#snippet aktion()}
		<a
			href="/scan"
			class="hidden rounded-xl bg-tuerkis px-4 py-2.5 text-sm font-extrabold text-white lg:inline-block"
			>Bon hochladen</a
		>
	{/snippet}

	<!-- ============ Oben: was zu tun ist ============ -->
	<div class="grid grid-cols-3 gap-3">
		{#each [{ t: 'Brauchen dich', n: z.brauchtDich, weg: '/inbox?status=brauchtDich', stark: true }, { t: 'Werden gelesen', n: z.wirdGelesen, weg: '/inbox?status=wirdGelesen', stark: false }, { t: 'Bestätigt', n: z.bestaetigt, weg: '/receipts?status=bestaetigt', stark: false }] as k (k.t)}
			<a
				href={k.weg}
				class="rounded-2xl bg-papier px-4 py-3.5 shadow-[0_0_0_1px_var(--color-linie)]"
				class:bg-tuerkis-flaeche={k.stark && k.n > 0}
			>
				<span class="block text-[10.5px] font-bold tracking-[0.08em] text-leise uppercase">{k.t}</span>
				<b class="mt-0.5 block text-[26px] leading-none font-extrabold tabular-nums">{k.n}</b>
			</a>
		{/each}
	</div>

	{#if z.fehlgeschlagen > 0}
		<p class="mt-3 rounded-xl bg-rot-flaeche px-3.5 py-2.5 text-[13px] font-semibold text-rot-dunkel">
			{z.fehlgeschlagen}
			{z.fehlgeschlagen === 1 ? 'Bon konnte' : 'Bons konnten'} nicht gelesen werden —
			<a href="/inbox?status=fehlgeschlagen" class="underline">ansehen und erneut lesen</a>
		</p>
	{/if}

	<section class="mt-6">
		<h2 class="mb-2 text-[11px] font-bold tracking-[0.08em] text-leise uppercase">Als Nächstes prüfen</h2>
		{#if data.wartend.length === 0}
			<div class="rounded-2xl bg-papier px-5 py-8 text-center shadow-[0_0_0_1px_var(--color-linie)]">
				<p class="font-bold">Alles geprüft.</p>
				<p class="mt-1 text-sm text-gedaempft">
					<a href="/scan" class="font-semibold text-tuerkis-dunkel">Nächsten Bon aufnehmen</a>
				</p>
			</div>
		{:else}
			<ul class="overflow-hidden rounded-2xl bg-papier shadow-[0_0_0_1px_var(--color-linie)]">
				{#each data.wartend as b, i (b.id)}
					<li class:border-t={i > 0} class="border-linie">
						<a href="/receipts/{b.id}" class="flex items-center gap-3 px-4 py-3">
							<span class="min-w-0 flex-1">
								<b class="block truncate text-[14px] font-bold">{b.merchant ?? 'Unbekannter Händler'}</b>
								<span class="block truncate text-[12.5px] text-gedaempft">
									{formatWann(b.purchasedAt ?? b.createdAt)} · {b.positionen}
									{b.positionen === 1 ? 'Position' : 'Positionen'}
									{#if b.problems?.length}
										· <span class="text-bernstein">{b.problems.map(describeProblem).join(' · ')}</span>
									{:else if b.status === 'failed'}
										· <span class="text-rot-dunkel">{statusText(b.status)}</span>
									{/if}
								</span>
							</span>
							<span class="shrink-0 text-[14px] font-bold tabular-nums">
								{b.totalGrossCents !== null ? `${formatCents(b.totalGrossCents)} €` : '—'}
							</span>
							<Symbol name="rechts" size={16} />
						</a>
					</li>
				{/each}
			</ul>
			{#if data.wartendGesamt > data.wartend.length}
				<p class="mt-2 text-[13px]">
					<a href="/inbox?status=brauchtDich" class="font-semibold text-tuerkis-dunkel"
						>Alle {data.wartendGesamt} ansehen ›</a
					>
				</p>
			{/if}
		{/if}
	</section>

	<!-- ============ Unten: der Monat ============ -->
	<section class="mt-8">
		<h2 class="mb-2 text-[11px] font-bold tracking-[0.08em] text-leise uppercase">{monatsName}</h2>

		<div class="rounded-2xl bg-papier px-5 py-4 shadow-[0_0_0_1px_var(--color-linie)]">
			<span class="text-[12.5px] text-gedaempft">Bestätigte Ausgaben</span>
			<b class="mt-0.5 block text-[32px] leading-none font-extrabold tabular-nums"
				>{formatCents(m.bestaetigt.cent)} €</b
			>
			<p class="mt-1 text-[12.5px] text-gedaempft">
				aus {m.bestaetigt.bons}
				{m.bestaetigt.bons === 1 ? 'geprüftem Bon' : 'geprüften Bons'}
				{#if m.bestaetigt.ohneBetrag > 0}
					· {m.bestaetigt.ohneBetrag} davon ohne erkannte Endsumme
				{/if}
			</p>

			{#if vergleich}
				<p class="mt-2 text-[13px] font-semibold">
					<span class:text-rot-dunkel={vergleich.diff > 0} class:text-tuerkis-dunkel={vergleich.diff <= 0}>
						{vergleich.diff > 0 ? '+' : ''}{formatCents(vergleich.diff)} €
						({vergleich.prozent > 0 ? '+' : ''}{vergleich.prozent} %)
					</span>
					<span class="text-gedaempft">gegenüber dem Vormonat</span>
				</p>
			{:else}
				<p class="mt-2 text-[13px] text-leise">
					Kein Vergleich zum Vormonat — dort ist noch kein Bon bestätigt.
				</p>
			{/if}

			<!-- Der Vorbehalt steht IMMER dabei, nicht nur wenn er klein ist: eine
			     Monatssumme ist nur so wahr, wie wenig ungeprueft danebenliegt. -->
			{#if m.rueckstand.bons > 0}
				<p
					class="mt-3 rounded-xl bg-bernstein-flaeche px-3.5 py-2.5 text-[12.5px] font-semibold text-bernstein"
				>
					Noch nicht in dieser Zahl: {m.rueckstand.bons} ungeprüfte
					{m.rueckstand.bons === 1 ? 'Bon' : 'Bons'} über {formatCents(m.rueckstand.cent)} €
					{#if m.offen.bons > 0 && m.offen.bons < m.rueckstand.bons}
						({m.offen.bons} davon aus {monatsName})
					{/if}
					— <a href="/inbox?status=brauchtDich" class="underline">jetzt prüfen</a>
				</p>
			{/if}
		</div>

		<!-- Kategorien und Budgets: was es noch nicht gibt, bekommt keinen leeren Kasten,
		     sondern den Grund. Budgets erscheinen erst mit Etappe 5 und fehlen hier ganz. -->
		<div class="mt-3 rounded-2xl bg-papier px-5 py-4 shadow-[0_0_0_1px_var(--color-linie)]">
			<span class="text-[10.5px] font-bold tracking-[0.08em] text-leise uppercase">Nach Kategorie</span>
			<p class="mt-1.5 text-[13px] text-gedaempft">
				{#if data.kategorien.gesamt === 0}
					Noch keine Positionen erfasst.
				{:else if data.kategorien.mitKategorie === 0}
					Noch keine der {data.kategorien.gesamt} Positionen hat eine Kategorie — deshalb gibt es hier
					noch nichts auszuwerten.
				{:else}
					{data.kategorien.mitKategorie} von {data.kategorien.gesamt} Positionen haben eine Kategorie.
					Die Auswertung kommt, sobald genug zugeordnet ist.
				{/if}
			</p>
		</div>
	</section>
</Seite>
