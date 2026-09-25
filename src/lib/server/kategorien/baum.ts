/**
 * Der Startbestand aus dem Entwurf. Diese Liste ist die EINZIGE Quelle: die Migration
 * wird aus ihr erzeugt, und der Prompt fuer die Modell-Stufe ebenfalls. Zwei getrennte
 * Listen wuerden auseinanderlaufen, und das Modell duerfte dann Kategorien vorschlagen,
 * die es in der Datenbank nicht gibt.
 */
export const KATEGORIEBAUM = [
	{
		slug: 'lebensmittel',
		name: 'Lebensmittel',
		kinder: [
			{ slug: 'lebensmittel-obst-gemuese', name: 'Obst & Gemüse' },
			{ slug: 'lebensmittel-brot-backwaren', name: 'Brot & Backwaren' },
			{ slug: 'lebensmittel-milch-eier', name: 'Milchprodukte & Eier' },
			{ slug: 'lebensmittel-fleisch-wurst', name: 'Fleisch & Wurst' },
			{ slug: 'lebensmittel-fisch', name: 'Fisch' },
			{ slug: 'lebensmittel-tiefkuehl', name: 'Tiefkühl' },
			{ slug: 'lebensmittel-konserven-vorrat', name: 'Konserven & Vorrat' },
			{ slug: 'lebensmittel-grundnahrung', name: 'Grundnahrungsmittel' },
			{ slug: 'lebensmittel-gewuerze-saucen', name: 'Gewürze & Saucen' },
			{ slug: 'lebensmittel-suesswaren-snacks', name: 'Süßwaren & Snacks' },
			{ slug: 'lebensmittel-kaffee-tee', name: 'Kaffee & Tee' },
			{ slug: 'lebensmittel-babynahrung', name: 'Babynahrung' }
		]
	},
	{
		slug: 'getraenke',
		name: 'Getränke',
		kinder: [
			{ slug: 'getraenke-wasser', name: 'Wasser' },
			{ slug: 'getraenke-saefte', name: 'Säfte' },
			{ slug: 'getraenke-limonaden', name: 'Limonaden' },
			{ slug: 'getraenke-bier', name: 'Bier' },
			{ slug: 'getraenke-wein-spirituosen', name: 'Wein & Spirituosen' }
		]
	},
	{
		slug: 'drogerie',
		name: 'Drogerie',
		kinder: [
			{ slug: 'drogerie-koerperpflege', name: 'Körperpflege' },
			{ slug: 'drogerie-haarpflege', name: 'Haarpflege' },
			{ slug: 'drogerie-zahnpflege', name: 'Zahnpflege' },
			{ slug: 'drogerie-hygiene', name: 'Hygiene' },
			{ slug: 'drogerie-kosmetik', name: 'Kosmetik' },
			{ slug: 'drogerie-gesundheit-apotheke', name: 'Gesundheit & Apotheke' }
		]
	},
	{
		slug: 'haushalt',
		name: 'Haushalt',
		kinder: [
			{ slug: 'haushalt-reinigung', name: 'Reinigung' },
			{ slug: 'haushalt-waesche', name: 'Wäsche' },
			{ slug: 'haushalt-kuechenbedarf', name: 'Küchenbedarf' },
			{ slug: 'haushalt-papierwaren', name: 'Papierwaren' }
		]
	},
	{
		slug: 'tier',
		name: 'Tier',
		kinder: [
			{ slug: 'tier-futter', name: 'Futter' },
			{ slug: 'tier-zubehoer', name: 'Zubehör' }
		]
	},
	{ slug: 'garten-pflanzen', name: 'Garten & Pflanzen', kinder: [] },
	{ slug: 'kleidung-schuhe', name: 'Kleidung & Schuhe', kinder: [] },
	{ slug: 'elektronik-technik', name: 'Elektronik & Technik', kinder: [] },
	{ slug: 'baumarkt-werkzeug', name: 'Baumarkt & Werkzeug', kinder: [] },
	{ slug: 'buero-schreibwaren', name: 'Büro & Schreibwaren', kinder: [] },
	{
		slug: 'freizeit',
		name: 'Freizeit',
		kinder: [
			{ slug: 'freizeit-buecher-medien', name: 'Bücher & Medien' },
			{ slug: 'freizeit-spielzeug', name: 'Spielzeug' },
			{ slug: 'freizeit-sport', name: 'Sport' }
		]
	},
	{
		slug: 'mobilitaet',
		name: 'Mobilität',
		kinder: [
			{ slug: 'mobilitaet-kraftstoff', name: 'Kraftstoff' },
			{ slug: 'mobilitaet-oepnv', name: 'ÖPNV' },
			{ slug: 'mobilitaet-parken', name: 'Parken' }
		]
	},
	{
		slug: 'sonstiges',
		name: 'Sonstiges',
		kinder: [
			{ slug: 'sonstiges-pfand', name: 'Pfand' },
			{ slug: 'sonstiges-rabatt', name: 'Rabatt' },
			{ slug: 'sonstiges-unsortiert', name: 'Unsortiert' }
		]
	}
] as const;

/** Der Rueckfall der Kaskade. Bewusst eine echte Kategorie und kein null. */
export const SONSTIGES_UNSORTIERT_SLUG = 'sonstiges-unsortiert';

/**
 * Feste Stufe-0-Zweige der Kaskade (kaskade.ts): Pfand/Leergut und Rabatt sind keine
 * Produkte und werden nie durchs Modell geschickt. Bewusst HIER als Konstante neben
 * SONSTIGES_UNSORTIERT_SLUG definiert und NICHT als eigenes String-Literal in
 * kaskade.ts wiederholt: zwei Literale in zwei Dateien koennten auseinanderlaufen,
 * ohne dass es auffiele (Review Aufgabe 5, Befund 1/A) — mit nur EINER Quelle ist ein
 * Auseinanderlaufen strukturell ausgeschlossen. baum.test.ts prueft zusaetzlich, dass
 * beide Slugs tatsaechlich als Blatt in KATEGORIEBAUM existieren (Schutz gegen einen
 * Tippfehler hier an der Quelle selbst).
 */
export const SONSTIGES_PFAND_SLUG = 'sonstiges-pfand';
export const SONSTIGES_RABATT_SLUG = 'sonstiges-rabatt';
