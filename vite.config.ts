import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
// defineConfig aus 'vitest/config', nicht aus 'vite': nur dieser Typ kennt den
// `test`-Block unten. Mit dem Vite-Typ meldet `npm run check` einen Fehler,
// obwohl die Konfiguration zur Laufzeit korrekt ist — ein dauerhaft rotes
// `check` verdeckt echte Fehler.
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) => filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// See https://svelte.dev/docs/kit/adapters for more information about adapters.
			adapter: adapter()
		}),
		SvelteKitPWA({
			registerType: 'autoUpdate',
			manifest: {
				name: 'Bon-App',
				short_name: 'Bons',
				start_url: '/',
				display: 'standalone',
				background_color: '#ffffff',
				// Aus dem Icon AUSGEMESSEN, nicht geschätzt: der Verlauf läuft von
				// #1f548a nach #07aeb7, der Rand ist #111a3b. Vorher stand hier
				// #111111 — ein Schwarz, das im Icon nirgends vorkommt und die
				// Systemleiste neben der App aussehen liess statt dazu.
				theme_color: '#07aeb7',
				icons: [
					// RANDFUELLEND, nicht icon-192/512: die tragen einen undurchsichtigen
					// dunkelblauen Rahmen (#111a3b) um ein kleineres Abzeichen. Auf einem
					// Handy-Startbildschirm sieht der gewollt aus — als Fenster- und
					// Taskleistensymbol der installierten Desktop-App sieht man bei
					// wenigen Pixeln fast nur ihn, und das Symbol wirkt schwarz.
					//
					// icon-192.png bleibt trotzdem liegen: app.html verweist als
					// apple-touch-icon darauf, und der iPhone-Startbildschirm soll
					// aussehen wie bisher.
					{ src: '/icon-voll-192.png', sizes: '192x192', type: 'image/png' },
					{ src: '/icon-voll-512.png', sizes: '512x512', type: 'image/png' },
					// Android legt bei maskierbaren Icons eine eigene Form darüber und
					// schneidet grosszügig ab. Mit dem dunklen Rand des Originals bliebe
					// auf dem Startbildschirm ein dunkler Ring um ein geschrumpftes
					// Motiv; diese Fassung ist deshalb auf das Badge beschnitten, damit
					// die Maske in den Farbverlauf schneidet.
					{
						src: '/icon-maskable-512.png',
						sizes: '512x512',
						type: 'image/png',
						purpose: 'maskable'
					}
				]
			}
		})
	],
	test: { include: ['src/**/*.test.ts'], setupFiles: ['./vitest.setup.ts'] }
});
