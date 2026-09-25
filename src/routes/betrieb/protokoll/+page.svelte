<script lang="ts">
	import Seite from '$lib/client/geruest/Seite.svelte';
	import Reiter from '../Reiter.svelte';

	let { data } = $props();

	const zeit = (d: Date | string) => new Date(d).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'medium' });
	const details = (d: Record<string, unknown> | null) =>
		d ? Object.entries(d).map(([k, v]) => `${k}: ${v === null ? '—' : String(v)}`).join(' · ') : '';
</script>

<Seite titel="Betrieb" untertitel="Protokoll">
	<div class="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-4">
		<Reiter aktiv="protokoll" />
		<section class="rounded-xl border border-linie bg-papier p-4">
			<h2 class="text-sm font-extrabold">Die letzten {data.eintraege.length} Einträge</h2>
			{#if data.eintraege.length === 0}
				<p class="mt-2 text-[13px] text-gedaempft">Noch nichts protokolliert.</p>
			{:else}
				<ul class="mt-2 divide-y divide-linie text-[13px]">
					{#each data.eintraege as e (e.id)}
						<li class="py-2">
							<p><b>{e.aktion}</b> · {e.ziel ?? '—'}</p>
							<p class="text-[12px] text-gedaempft">{zeit(e.zeit)} · {e.wer ?? 'unbekannt'}{#if e.details} · {details(e.details)}{/if}</p>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	</div>
</Seite>
