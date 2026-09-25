<script lang="ts">
	/**
	 * Die Unterleiste der Einstellungen. Stand vorher wortwoertlich in jeder
	 * Einstellungsseite; mit der dritten Seite (Budgets) waere es die dritte Abschrift
	 * gewesen — und eine neue Seite haette gefehlt, ohne dass es auffaellt.
	 */
	const ZIELE = [
		{ id: 'haushalt', weg: '/settings/household', titel: 'Haushalt' },
		{ id: 'budgets', weg: '/settings/budgets', titel: 'Budgets' },
		{ id: 'matrix', weg: '/settings/matrix', titel: 'Matrix-Bot' }
	] as const;

	let { aktiv }: { aktiv: (typeof ZIELE)[number]['id'] } = $props();
</script>

<nav class="mb-4 flex flex-wrap gap-2 text-[13px] font-bold" aria-label="Einstellungen">
	{#each ZIELE as z (z.id)}
		{@const ist = z.id === aktiv}
		<a
			href={z.weg}
			class="rounded-full px-3 py-1.5"
			class:bg-tinte={ist}
			class:text-white={ist}
			class:border={!ist}
			class:border-linie={!ist}
			class:bg-papier={!ist}
			class:text-gedaempft={!ist}
			aria-current={ist ? 'page' : undefined}>{z.titel}</a
		>
	{/each}
</nav>
