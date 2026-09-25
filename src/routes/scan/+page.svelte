<script lang="ts">
	import Scannen from '$lib/client/scannen/Scannen.svelte';

	let { data } = $props();
</script>

<Scannen {data} />
