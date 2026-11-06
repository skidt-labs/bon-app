/**
 * Der Kategoriebaum. Diese Liste ist die EINZIGE Quelle: die Migrationen werden aus ihr
 * erzeugt (0011 Startbestand, 0035 Umbau 0.12.0), und der Prompt fuer die Modell-Stufe
 * ebenfalls. Zwei getrennte Listen wuerden auseinanderlaufen, und das Modell duerfte dann
 * Kategorien vorschlagen, die es in der Datenbank nicht gibt.
 *
 * Stand 0.12.0 (Nutzer 06.11.2026): Lebensmittel, Suesses, Snacks, Hygiene, Baby,
 * Medikamente, Mobilitaet, Baumarkt, Garten, Kleidung, Technik — dazu Freizeit, Tier und
 * Sonstiges. Beim Umbau blieben Ids und Slugs der Unterkategorien gleich, nur Eltern und
 * Namen aenderten sich: deshalb passt das Praefix eines Slugs nicht immer zur Oberkategorie
 * (`getraenke-wasser` liegt unter Lebensmittel, `drogerie` heisst „Hygiene“). Ein Slug wird
 * nie umbenannt — er ist der stabile Schluessel der Migrationen.
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
			{ slug: 'lebensmittel-kaffee-tee', name: 'Kaffee & Tee' },
			{ slug: 'getraenke-wasser', name: 'Wasser' },
			{ slug: 'getraenke-saefte', name: 'Säfte' },
			{ slug: 'getraenke-limonaden', name: 'Limonaden' },
			{ slug: 'getraenke-bier', name: 'Bier' },
			{ slug: 'getraenke-wein-spirituosen', name: 'Wein & Spirituosen' }
		]
	},
	{
		slug: 'suesses',
		name: 'Süßes',
		kinder: [{ slug: 'suesses-suessigkeiten', name: 'Süßigkeiten' }]
	},
	{
		slug: 'snacks',
		name: 'Snacks',
		kinder: [{ slug: 'snacks-knabberzeug', name: 'Knabberzeug' }]
	},
	{
		slug: 'drogerie',
		name: 'Hygiene',
		kinder: [
			{ slug: 'drogerie-koerperpflege', name: 'Körperpflege' },
			{ slug: 'drogerie-haarpflege', name: 'Haarpflege' },
			{ slug: 'drogerie-zahnpflege', name: 'Zahnpflege' },
			{ slug: 'drogerie-hygiene', name: 'Hygieneartikel' },
			{ slug: 'drogerie-kosmetik', name: 'Kosmetik' },
			{ slug: 'haushalt-reinigung', name: 'Reinigung' },
			{ slug: 'haushalt-waesche', name: 'Wäsche' },
			{ slug: 'haushalt-papierwaren', name: 'Papierwaren' }
		]
	},
	{
		slug: 'baby',
		name: 'Baby',
		kinder: [
			{ slug: 'lebensmittel-babynahrung', name: 'Babynahrung' },
			{ slug: 'baby-pflege', name: 'Babypflege' }
		]
	},
	{
		slug: 'medikamente',
		name: 'Medikamente',
		kinder: [{ slug: 'drogerie-gesundheit-apotheke', name: 'Gesundheit & Apotheke' }]
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
		slug: 'baumarkt-werkzeug',
		name: 'Baumarkt',
		kinder: [{ slug: 'haushalt-kuechenbedarf', name: 'Küchenbedarf' }]
	},
	{ slug: 'garten-pflanzen', name: 'Garten', kinder: [] },
	{ slug: 'kleidung-schuhe', name: 'Kleidung', kinder: [] },
	{
		slug: 'elektronik-technik',
		name: 'Technik',
		kinder: [{ slug: 'buero-schreibwaren', name: 'Büro & Schreibwaren' }]
	},
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
		slug: 'tier',
		name: 'Tier',
		kinder: [
			{ slug: 'tier-futter', name: 'Futter' },
			{ slug: 'tier-zubehoer', name: 'Zubehör' }
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

/**
 * Mit 0.12.0 entfallen (leer bzw. aufgeteilt). Migration 0035 haengt ihre Positionen auf
 * Unsortiert und loescht sie. Hier benannt, damit Tests pruefen koennen, dass keiner davon
 * zurueck in den Baum wandert — 0011 legt sie bei einem erneuten Lauf wieder an, 0035 raeumt
 * sie danach wieder weg.
 */
export const ENTFALLENE_SLUGS = ['getraenke', 'haushalt', 'lebensmittel-suesswaren-snacks'] as const;

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
