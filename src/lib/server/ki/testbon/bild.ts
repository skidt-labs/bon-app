import sharp from 'sharp';
import { TESTBON_TEXT } from './text';

/**
 * Derselbe erfundene Bon als Bild — fuer den Testknopf eines Bildweg-Anbieters. Aus dem
 * Text erzeugt statt als Datei abgelegt: so koennen Text und Bild nie auseinanderlaufen.
 */
export async function testbonBild(): Promise<Buffer> {
	const zeilen = TESTBON_TEXT.split('\n');
	const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	const hoehe = 40 + zeilen.length * 26;
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="560" height="${hoehe}">
<rect width="100%" height="100%" fill="#ffffff"/>
<text x="20" y="36" font-family="DejaVu Sans Mono, monospace" font-size="18" fill="#111111" xml:space="preserve">${zeilen
		.map((z, i) => `<tspan x="20" dy="${i === 0 ? 0 : 26}">${esc(z)}</tspan>`)
		.join('')}</text>
</svg>`;
	return sharp(Buffer.from(svg)).png().toBuffer();
}
