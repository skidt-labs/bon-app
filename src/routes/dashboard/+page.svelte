<script lang="ts">
	import Startseite from '$lib/client/dashboard/Startseite.svelte';
	let { data } = $props();
</script>

<Startseite {data} />
