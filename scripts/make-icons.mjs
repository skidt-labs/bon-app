import sharp from 'sharp';

const square = (size) =>
	sharp({ create: { width: size, height: size, channels: 4, background: '#111111' } })
		.png()
		.toFile(`static/icon-${size}.png`);

await Promise.all([square(192), square(512)]);
console.log('Icons erzeugt');
