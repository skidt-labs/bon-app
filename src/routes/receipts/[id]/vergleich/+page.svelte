<script lang="ts">
	import Seite from '$lib/client/geruest/Seite.svelte';
	import { bildVersion, formatWann, statusText } from '$lib/bons/anzeige';
	import { formatCents } from '$lib/money';

	let { data } = $props();

	const untertitel = $derived(
		[
			data.bon.merchantNameRaw ?? 'Unbekannter Händler',
			data.bon.purchasedAt ? formatWann(data.bon.purchasedAt) : null,
			data.bon.totalGrossCents !== null ? `${formatCents(data.bon.totalGrossCents)} €` : null
		]
			.filter(Boolean)
			.join(' · ')
	);
</script>

<Seite titel="Mit anderem Bon vergleichen" {untertitel} haushalt={data.haushalt} nutzer={data.user?.displayName ?? null}>
	{#snippet aktion()}
		<a href="/receipts/{data.bon.id}" class="rounded-xl border border-linie bg-papier px-3.5 py-2 text-sm font-bold">Zurück</a>
	{/snippet}

	<!-- GET: die Suche steht in der Adresse und ueberlebt Neuladen und Zurueck. -->
	<form method="GET" class="mb-4 flex gap-2" role="search">
		<label class="sr-only" for="suche">Laden oder Summe</label>
		<input
			id="suche"
			name="suche"
			type="search"
			value={data.suche}
			placeholder="Laden oder Summe, z. B. 31,46"
			class="min-w-0 flex-1 rounded-xl border border-linie bg-papier px-3.5 py-2.5 text-[15px]"
		/>
		<button type="submit" class="rounded-xl bg-tuerkis px-4 py-2.5 text-sm font-extrabold text-white">Suchen</button>
	</form>

	{#if data.vorschlaege.length === 0}
		<p class="rounded-2xl border border-linie bg-papier p-5 text-gedaempft">Keine passenden Bons gefunden.</p>
	{:else}
		<ul class="grid gap-2">
			{#each data.vorschlaege as v (v.id)}
				<li>
					<a
						href="/receipts/{data.bon.id}/vergleich/{v.id}"
						class="flex items-center gap-3 rounded-2xl border border-linie bg-papier p-3 hover:border-tuerkis"
					>
						<img
							src="/receipts/{v.id}/image?vorschau&v={bildVersion(v.thumbPath)}"
							alt=""
							loading="lazy"
							class="h-16 w-12 shrink-0 rounded-md bg-chip object-cover object-top"
						/>
						<span class="grid min-w-0 flex-1 gap-0.5">
							<b class="truncate font-bold">{v.merchantNameRaw ?? 'Unbekannter Händler'}</b>
							<span class="text-[13px] text-gedaempft tabular-nums">
								{v.purchasedAt ? formatWann(v.purchasedAt) : `ohne Datum · eingegangen ${formatWann(v.createdAt)}`}
							</span>
						</span>
						<span class="grid shrink-0 justify-items-end gap-1">
							<b class="tabular-nums" class:text-leise={v.totalGrossCents === null}
								>{v.totalGrossCents !== null ? `${formatCents(v.totalGrossCents)} €` : '—'}</b
							>
							<span class="rounded-full bg-chip px-2 py-0.5 text-[11px] font-bold text-gedaempft">{statusText(v.status)}</span>
						</span>
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</Seite>
