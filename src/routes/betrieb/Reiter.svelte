<script lang="ts">
	let { aktiv }: { aktiv: 'uebersicht' | 'ki' | 'protokoll' } = $props();
	const reiter = [
		{ id: 'uebersicht', titel: 'Übersicht', href: '/betrieb' },
		{ id: 'ki', titel: 'KI', href: '/betrieb/ki' },
		{ id: 'protokoll', titel: 'Protokoll', href: '/betrieb/protokoll' }
	] as const;
</script>

<nav class="flex gap-1 rounded-xl bg-chip p-1" aria-label="Betrieb">
	{#each reiter as r (r.id)}
		<a
			href={r.href}
			aria-current={r.id === aktiv ? 'page' : undefined}
			class="flex-1 rounded-lg px-3 py-1.5 text-center text-[13px] font-bold {r.id === aktiv
				? 'bg-papier text-tinte'
				: 'text-gedaempft'}">{r.titel}</a
		>
	{/each}
</nav>
