<script lang="ts">
	import type { SymbolName } from './navigation';

	/**
	 * Strichsymbole, 24er-Raster, Strichstaerke 1.9, runde Enden. Farbe ueber
	 * `currentColor`, damit das Symbol die Textfarbe seines Elternteils annimmt.
	 * Entscheidung des Betreibers (Runde 3): echte Symbole, keine blanken Flaechen.
	 */
	let {
		name,
		size = 20,
		class: klasse = ''
	}: { name: SymbolName; size?: number; class?: string } = $props();
</script>

<svg
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="1.9"
	stroke-linecap="round"
	stroke-linejoin="round"
	class={klasse}
	aria-hidden="true"
>
	{#if name === 'haus'}
		<path d="M3.5 10.5 12 4l8.5 6.5V20H3.5z" /><path d="M9.5 20v-6h5v6" />
	{:else if name === 'kamera'}
		<path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" />
	{:else if name === 'ablage'}
		<path d="M3 13h5l2 3h4l2-3h5" /><path d="M5.5 5h13l2.5 8v6H3v-6z" />
	{:else if name === 'beleg'}
		<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h6M9 16h4" />
	{:else if name === 'balken'}
		<path d="M5 20v-8M11 20V5M17 20v-5" /><path d="M2 20h20" />
	{:else if name === 'zahnrad'}
		<!-- Zahnkranz statt Speichen: acht Striche um einen Kreis lasen sich als Sonne
		     (Rueckmeldung des Betreibers am 17.09.). Form nach Lucide "settings" (MIT). -->
		<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" />
	{:else if name === 'nutzer'}
		<circle cx="12" cy="8" r="4" /><path d="M4 21c0-4.2 3.6-7 8-7s8 2.8 8 7" />
	{:else if name === 'suche'}
		<circle cx="11" cy="11" r="6.5" /><path d="m20 20-4-4" />
	{:else if name === 'links'}
		<path d="m15 6-6 6 6 6" />
	{:else if name === 'rechts'}
		<path d="m9 6 6 6-6 6" />
	{/if}
</svg>
