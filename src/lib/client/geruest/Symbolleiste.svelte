<script lang="ts">
	import Symbol from './Symbol.svelte';
	import { SEITEN, type SeitenId } from './navigation';
	import { leisteOffen, leisteSetzen } from './zustand';

	let {
		aktiv,
		zaehler,
		nutzer,
		haushalt
	}: { aktiv: SeitenId | null; zaehler: number; nutzer: string; haushalt: string | null } = $props();

	// Serverseitig gerendert ist die Leiste zu; der gemerkte Zustand kommt erst im
	// Browser dazu. Der kurze Sprung beim ersten Laden ist der Preis dafuer, dass die
	// Seite ohne JavaScript und ohne Speicher trotzdem richtig aussieht.
	let offen = $state(false);
	$effect(() => {
		offen = leisteOffen(typeof localStorage === 'undefined' ? null : localStorage);
	});

	function umschalten() {
		offen = !offen;
		leisteSetzen(typeof localStorage === 'undefined' ? null : localStorage, offen);
	}

	const kuerzel = $derived(nutzer.trim().charAt(0).toUpperCase() || '?');
</script>

<aside
	class="sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-linie bg-papier py-4 lg:flex"
	class:w-16={!offen}
	class:w-[216px]={offen}
	class:items-center={!offen}
	class:px-2.5={offen}
	aria-label="Hauptnavigation"
>
	<div class="mb-5 flex items-center gap-2.5" class:px-1.5={offen}>
		<!--
			Hier stand bis 18.09.2026 ein leeres <span> mit bg-tinte — ein Platzhalter aus
			dem Geruestbau, der nie ersetzt wurde. Auf dem Schreibtisch sah das aus wie ein
			schwarzes Quadrat neben dem Namen, weil es genau das war.
			Kein alt-Text: direkt daneben steht "Bon-App" als Text, eine Vorlesehilfe soll
			den Namen nicht doppelt ansagen.
		-->
		<img
			src="/logo-96.png"
			alt=""
			width="30"
			height="30"
			class="block h-[30px] w-[30px] shrink-0 rounded-lg"
		/>
		{#if offen}
			<span class="min-w-0">
				<span class="block text-base font-extrabold tracking-tight">Bon-App</span>
				{#if haushalt}<span class="block truncate text-xs font-semibold text-leise">{haushalt}</span>{/if}
			</span>
		{/if}
	</div>

	<nav class="flex flex-col gap-1.5" class:items-center={!offen}>
		{#each SEITEN as seite (seite.id)}
			{@const ist = seite.id === aktiv}
			<a
				href={seite.weg}
				class="group relative flex h-11 items-center gap-2.5 rounded-xl font-bold"
				class:w-11={!offen}
				class:justify-center={!offen}
				class:px-2.5={offen}
				class:bg-flaeche={ist}
				class:text-tuerkis-dunkel={ist}
				class:text-gedaempft={!ist}
				class:shadow-[inset_3px_0_0_var(--color-tuerkis)]={ist}
				aria-current={ist ? 'page' : undefined}
			>
				<Symbol name={seite.symbol} />
				{#if offen}
					<span class="text-[13.5px]" class:text-tinte={ist}>{seite.titel}</span>
				{/if}
				{#if seite.id === 'posteingang' && zaehler > 0}
					<b
						class="rounded-full bg-bernstein px-1.5 text-[11px] leading-4 text-white"
						class:absolute={!offen}
						class:top-1={!offen}
						class:right-1={!offen}
						class:ml-auto={offen}>{zaehler}</b
					>
				{/if}
				{#if !offen}
					<!-- Der Name erscheint beim Zeigen; die aktive Seite traegt ihn dauerhaft. -->
					<span
						class="pointer-events-none absolute left-14 z-10 rounded-md bg-tinte px-2 py-1 text-xs font-bold whitespace-nowrap text-white"
						class:hidden={!ist}
						class:group-hover:block={!ist}>{seite.titel}</span
					>
				{/if}
			</a>
		{/each}
	</nav>

	<div class="mt-auto flex flex-col gap-2.5" class:items-center={!offen}>
		<button
			type="button"
			onclick={umschalten}
			class="flex h-9 items-center gap-2.5 rounded-lg border border-dashed border-linie text-xs font-bold text-leise"
			class:w-9={!offen}
			class:justify-center={!offen}
			class:px-2={offen}
			aria-expanded={offen}
			aria-label={offen ? 'Leiste einklappen' : 'Leiste ausklappen'}
		>
			<Symbol name={offen ? 'links' : 'rechts'} size={18} />
			{#if offen}<span>Einklappen</span>{/if}
		</button>
		<!--
			Formular statt Link: Abmelden veraendert Zustand, und was Zustand veraendert,
			gehoert nicht hinter ein GET. Ein <a href> schickte ein GET an einen Endpunkt,
			der nur POST kennt — der Klick endete in 405 und tat nichts. Ausserdem koennte
			ein GET-Abmeldeweg von jedem <img src="/auth/logout"> ausgeloest werden.
			`class="contents"` haelt das Formular aus dem Flex-Layout der Leiste heraus.
		-->
		<form method="POST" action="/auth/logout" class="contents">
			<button
				type="submit"
				class="flex w-full items-center gap-2.5 rounded-lg text-left"
				class:px-1={offen}
				title="Abmelden"
			>
				<span
					class="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-full bg-chip text-sm font-extrabold text-gedaempft"
					aria-hidden="true">{kuerzel}</span
				>
				{#if offen}
					<span class="min-w-0 text-[13px] font-bold">
						<span class="block truncate">{nutzer}</span>
						<span class="block text-[11.5px] font-semibold text-leise">Abmelden</span>
					</span>
				{/if}
			</button>
		</form>
	</div>
</aside>
