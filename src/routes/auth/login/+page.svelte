<script lang="ts">
	let { data } = $props();
</script>

<svelte:head><title>Anmelden — Bon</title></svelte:head>

<div class="grid min-h-dvh place-items-center bg-flaeche px-4 font-sans text-tinte">
	<main class="w-full max-w-sm">
		<div class="mb-8 flex flex-col items-center gap-3 text-center">
			<img src="/logo-96.png" alt="" width="48" height="48" class="h-12 w-12 rounded-xl" />
			<h1 class="text-xl font-extrabold">Bon</h1>
		</div>

		{#if data.abgemeldet}
			<!--
				Die eigentliche Rueckmeldung, die vorher fehlte. Ohne sie sah ein Abmelden
				aus wie ein Fehler: die Sitzung war geloescht, der Anbieter meldete aber
				sofort wieder an, und der Mensch landete wortlos wieder in der App.
			-->
			<p
				class="mb-6 rounded-xl bg-chip px-4 py-3 text-center text-[13px] font-semibold text-gedaempft"
				role="status"
			>
				Du bist abgemeldet.
			</p>
		{/if}

		<a
			href="/auth/login/oidc"
			class="flex w-full items-center justify-center rounded-xl bg-tinte px-4 py-3.5 text-[15px] font-bold text-flaeche"
		>
			Mit {data.anbieter} anmelden
		</a>

		<p class="mt-6 text-center text-[12.5px] leading-relaxed text-leise">
			Die Abmeldung gilt nur für Bon. Bei {data.anbieter} bleibst du angemeldet — ein Klick
			genügt, um zurückzukommen.
		</p>
	</main>
</div>
