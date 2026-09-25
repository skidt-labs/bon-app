<script lang="ts">
	import Symbol from './Symbol.svelte';
	import { SEITEN, HANDY_ZIELE, type SeitenId } from './navigation';

	let { aktiv, zaehler }: { aktiv: SeitenId | null; zaehler: number } = $props();

	const ziele = $derived(HANDY_ZIELE.map((id) => SEITEN.find((s) => s.id === id)!));
</script>

<!-- Fest unten, vier Ziele, daumengross. Scannen als erhoehter Knopf: das
     ist, wofuer die App zuerst da ist. `env(safe-area-inset-bottom)` haelt die Leiste
     ueber der Systemgeste des Handys. -->
<nav
	class="fixed inset-x-0 bottom-0 z-20 grid grid-cols-4 border-t border-linie bg-papier px-1.5 pt-2 lg:hidden"
	style="padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 10px)"
	aria-label="Hauptnavigation"
>
	{#each ziele as seite (seite.id)}
		{@const ist = seite.id === aktiv}
		{#if seite.id === 'scannen'}
			<a
				href={seite.weg}
				class="relative grid justify-items-center pt-9 text-[11px] font-bold text-tinte"
				aria-current={ist ? 'page' : undefined}
			>
				<span
					class="absolute -top-7 grid h-[58px] w-[58px] place-items-center rounded-full bg-tuerkis text-white shadow-[0_8px_20px_rgba(7,174,183,.35),0_0_0_6px_var(--color-papier)]"
					aria-hidden="true"
				>
					<Symbol name="kamera" size={26} class="stroke-[2.1]" />
				</span>
				{seite.titel}
			</a>
		{:else}
			<a
				href={seite.weg}
				class="relative grid justify-items-center gap-0.5 pt-0.5 text-[11px] font-bold"
				class:text-tuerkis-dunkel={ist}
				class:text-leise={!ist}
				aria-current={ist ? 'page' : undefined}
			>
				<Symbol name={seite.symbol} size={23} />
				{seite.titel}
				{#if seite.id === 'posteingang' && zaehler > 0}
					<b class="absolute top-0 left-[calc(50%+6px)] rounded-full bg-bernstein px-1.5 text-[10px] leading-4 text-white">{zaehler}</b>
				{/if}
			</a>
		{/if}
	{/each}
</nav>
