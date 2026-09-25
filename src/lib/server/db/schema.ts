import {
	pgTable,
	uuid,
	text,
	timestamp,
	pgEnum,
	integer,
	jsonb,
	index,
	unique,
	uniqueIndex,
	date,
	boolean,
	foreignKey,
	primaryKey,
	customType,
	type AnyPgColumn
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const households = pgTable('households', {
	id: uuid('id').primaryKey().defaultRandom(),
	name: text('name').notNull(),
	// Ohne Aufgabe mehr, aber nicht ohne Bedingung: `not null unique`.
	//
	// Der Slug trug bis 18.09.2026 den Upsert auf den einen Haushalt 'default'. Seit jede
	// Erstanmeldung einen EIGENEN Haushalt bekommt, gibt es nichts mehr zusammenzufuehren,
	// und erstanmeldungAnlegen() setzt darum einen Zufallswert. Die Vorgabe 'default'
	// steht noch da und ist eine Falle: wer einen Haushalt ohne ausdruecklichen Slug
	// einfuegt, kollidiert ab dem ZWEITEN mit der Eindeutigkeit — und zwar mit einem
	// Datenbankfehler statt einer Meldung. Die Spalte ganz zu entfernen ist eine eigene
	// Migration wert, solange niemand sie mehr liest.
	// Zwei gleichzeitige Erstanmeldungen duerfen nicht zwei Haushalte erzeugen —
	// der Unique-Index macht das zu einem Datenbank-Constraint, nicht zu einer
	// Zusicherung im Anwendungscode.
	slug: text('slug').notNull().unique().default('default'),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

export const users = pgTable('users', {
	id: uuid('id').primaryKey().defaultRandom(),
	oidcSub: text('oidc_sub').notNull().unique(),
	email: text('email').notNull(),
	displayName: text('display_name').notNull(),
	// Die Zugehoerigkeit stand bis 18.09.2026 hier als `household_id`. Sie liegt jetzt
	// ausschliesslich in `household_members` — zusammen mit der Rolle, zu der sie gehoert.
	// Zwei Orte fuer dieselbe Aussage hatten genau einen Tag lang Bestand und kosteten in
	// dieser Zeit zwei Befunde (der Matrix-Bot las die Spalte, als sie nicht mehr die
	// Wahrheit war; ein entferntes Mitglied kam darueber wieder herein).
	/**
	 * Gesperrt ab — null heisst: der Zugang steht offen.
	 *
	 * Gesperrt ist NICHT geloescht: Bons, Mitgliedschaften und Berichte bleiben, wie sie
	 * sind. Sperren ist eine Zugangsfrage, kein Datenverlust; fuer den gibt es
	 * „Mitglied entfernen" mit seiner eigenen, ausdruecklichen Warnung.
	 *
	 * `validateSession` liefert bei gesetztem Wert `null` — die Sitzung ist damit sofort
	 * ungueltig und nicht erst nach ihren 30 Tagen.
	 */
	gesperrtAm: timestamp('gesperrt_am', { withTimezone: true }),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

/**
 * Drizzle 0.45 hat kein eingebautes bytea. Der Treiber (pg) liefert und nimmt Buffer.
 */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
	dataType: () => 'bytea'
});

/** text = OCR liest lokal, nur der Text geht ans Modell. bild = das FOTO geht ans Modell. */
export const kiWeg = pgEnum('ki_weg', ['text', 'bild']);

/**
 * Ein eingerichteter KI-Anbieter (Entwurf 2026-09-23-ki-anbieter-verwaltung).
 *
 * Der Schluessel steht NUR verschluesselt hier (AES-256-GCM, siehe ki/geheimnis.ts);
 * `schluessel_ende` sind seine letzten vier Zeichen fuer die Anzeige `••••a3f9`.
 * Preise in Millionstel Euro je Million Tokens, `null` = unbekannt (NICHT kostenlos).
 * `test_ok` wird bei jeder Aenderung zurueckgesetzt: Aktivieren verlangt einen
 * erfolgreichen Test NACH der letzten Aenderung.
 */
export const kiAnbieter = pgTable('ki_anbieter', {
	id: uuid('id').primaryKey().defaultRandom(),
	name: text('name').notNull(),
	weg: kiWeg('weg').notNull(),
	baseUrl: text('base_url').notNull(),
	modell: text('modell').notNull(),
	schluesselEnc: bytea('schluessel_enc'),
	schluesselEnde: text('schluessel_ende'),
	zeitlimitMs: integer('zeitlimit_ms').notNull(),
	preisEinMicro: integer('preis_ein_micro'),
	preisAusMicro: integer('preis_aus_micro'),
	zuletztGetestet: timestamp('zuletzt_getestet', { withTimezone: true }),
	testOk: boolean('test_ok'),
	testErgebnis: text('test_ergebnis'),
	angelegtAm: timestamp('angelegt_am', { withTimezone: true }).notNull().defaultNow(),
	geaendertAm: timestamp('geaendert_am', { withTimezone: true }).notNull().defaultNow()
});

/**
 * Einstellungen der INSTANZ, nicht eines Haushalts. Genau eine Zeile, `id` ist immer 1 —
 * dasselbe Muster wie `matrix_bot_state`.
 */
export const instanz = pgTable('instanz', {
	id: integer('id').primaryKey().default(1),
	/**
	 * true (Vorgabe, heutiges Verhalten): eine Erstanmeldung legt einen eigenen Haushalt
	 * an. false: sie wird abgewiesen, es braucht eine Einladung.
	 *
	 * Greift NUR bei der Erstanmeldung. Ein bestehender Nutzer ohne Mitgliedschaft
	 * bekommt weiterhin seinen eigenen Haushalt zurueck — sonst waere er ausgesperrt,
	 * und genau das war Befund R13.
	 */
	selbstbedienung: boolean('selbstbedienung').notNull().default(true),
	/**
	 * null = die .env gilt (heutiges Verhalten). `restrict`: der aktive Anbieter laesst
	 * sich nicht loeschen — der Worker stuende sonst ohne Konfiguration da.
	 */
	aktiverKiAnbieter: uuid('aktiver_ki_anbieter').references(() => kiAnbieter.id, {
		onDelete: 'restrict'
	}),
	/** Steigt bei jeder Aenderung am aktiven Anbieter; daran erkennt der Worker, dass er neu laden muss. */
	kiStand: integer('ki_stand').notNull().default(0),
	geaendertAm: timestamp('geaendert_am', { withTimezone: true }).notNull().defaultNow()
});

export const rolle = pgEnum('rolle', ['verwalter', 'mitglied']);

/**
 * Wer zu welchem Haushalt gehoert und was er dort darf.
 *
 * Die Eindeutigkeit steht auf `user_id`, NICHT auf dem Paar: ein Nutzer gehoert zu
 * genau einem Haushalt. Die Sitzung traegt einen Haushalt, jede Abfrage filtert auf
 * einen Haushalt — eine zweite Mitgliedschaft waere kein Feature, sondern ein
 * Zustand, in dem nicht entscheidbar ist, welcher Haushalt gemeint war. Die Regel
 * gehoert deshalb in die Datenbank, nicht in die Oberflaeche. Sie spaeter zu lockern
 * ist eine Zeile Migration.
 *
 * Die Rolle sagt, was jemand TUN darf — nie, was er SIEHT. Sichtbarkeit haengt allein
 * an `sichtbarkeit` und am Eigentuemer.
 */
export const householdMembers = pgTable('household_members', {
	id: uuid('id').primaryKey().defaultRandom(),
	householdId: uuid('household_id')
		.notNull()
		.references(() => households.id, { onDelete: 'cascade' }),
	userId: uuid('user_id')
		.notNull()
		.unique()
		.references(() => users.id, { onDelete: 'cascade' }),
	rolle: rolle('rolle').notNull(),
	beigetretenAm: timestamp('beigetreten_am', { withTimezone: true }).notNull().defaultNow()
});

/**
 * Ein Einmal-Link, um einem bestehenden Haushalt beizutreten. Erzeugt vom Verwalter,
 * eingeloest von jemand anderem — siehe haushalt/einladungen.ts fuer die Regeln
 * (Ablauf, Verbrauch, was mit dem alten Haushalt des Einloesenden passiert).
 */
export const einladungen = pgTable('einladungen', {
	id: uuid('id').primaryKey().defaultRandom(),
	householdId: uuid('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
	/**
	 * Nur der Hash. Der Klartext steht in einer URL und landet damit in Browserverlauf,
	 * Chatprotokollen und womoeglich in Zugriffslogs — er darf nicht zusaetzlich im
	 * Klartext in der Datenbank liegen.
	 */
	tokenHash: text('token_hash').notNull().unique(),
	rolle: rolle('rolle').notNull().default('mitglied'),
	erstelltVon: uuid('erstellt_von').notNull().references(() => users.id),
	erstelltAm: timestamp('erstellt_am', { withTimezone: true }).notNull().defaultNow(),
	laeuftAbAm: timestamp('laeuft_ab_am', { withTimezone: true }).notNull(),
	eingeloestAm: timestamp('eingeloest_am', { withTimezone: true }),
	eingeloestVon: uuid('eingeloest_von').references(() => users.id)
});

export const sessions = pgTable('sessions', {
	id: text('id').primaryKey(),
	userId: uuid('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	expiresAt: timestamp('expires_at', { withTimezone: true }).notNull()
});

export const receiptStatus = pgEnum('receipt_status', [
	'pending',
	'extracting',
	'review',
	'confirmed',
	'failed',
	// Ein Mensch hat bestaetigt, dass dieser Bon ein zweites Foto eines schon erfassten
	// Einkaufs ist. Kein Loeschen: Bild und Daten bleiben, der Bon faellt nur aus
	// Posteingang und Berichten heraus (die zaehlen ausdruecklich 'confirmed') und laesst
	// sich wiederherstellen. Siehe bons/doppelt.ts.
	'doppelt'
]);

export const lineType = pgEnum('line_type', [
	'article',
	'deposit',
	'deposit_return',
	'discount',
	'loyalty',
	'info'
]);

// 'email' ist in Phase 1 unbenutzt, steht aber schon im Enum: Werte nachträglich
// in Postgres zu ergänzen ist eine Migration mehr als es wert ist.
export const receiptSource = pgEnum('receipt_source', ['camera', 'upload', 'email', 'matrix']);

// Woher die Kategorie stammt. Entscheidet, ob die Zeile in der Pruef-Ansicht
// auffaellt: 'rule' ist gelerntes Wissen und laeuft still durch, 'llm' ist geraten,
// 'manual' hat der Mensch selbst gesetzt, 'none' heisst unsortiert.
export const categorySource = pgEnum('category_source', ['rule', 'llm', 'manual', 'none']);

/**
 * Wer einen Bon oder einen Topf sehen darf — INNERHALB eines Haushalts.
 *
 * Zweite Achse neben dem Haushalt, nicht Teil von ihm: der Haushalt sagt, zu WEM die
 * Daten gehoeren, die Sichtbarkeit sagt, wer davon sie sehen darf. Die Rolle
 * (verwalter/mitglied) hat damit nichts zu tun — sie sagt, was jemand TUN darf.
 * Ein Verwalter sieht die privaten Bons seiner Mitglieder NICHT; sonst waere "privat"
 * in einem Zwei-Personen-Haushalt ein leeres Wort.
 */
export const sichtbarkeit = pgEnum('sichtbarkeit', ['geteilt', 'privat']);

export const merchants = pgTable('merchants', {
	id: uuid('id').primaryKey().defaultRandom(),
	name: text('name').notNull(),
	normalizedName: text('normalized_name').notNull().unique()
});

export const merchantLocations = pgTable('merchant_locations', {
	id: uuid('id').primaryKey().defaultRandom(),
	merchantId: uuid('merchant_id')
		.notNull()
		.references(() => merchants.id),
	address: text('address'),
	taxId: text('tax_id')
});

export const receipts = pgTable(
	'receipts',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		householdId: uuid('household_id')
			.notNull()
			.references(() => households.id),
		uploadedBy: uuid('uploaded_by')
			.notNull()
			.references(() => users.id),
		merchantId: uuid('merchant_id').references(() => merchants.id),
		merchantLocationId: uuid('merchant_location_id').references(() => merchantLocations.id),
		merchantNameRaw: text('merchant_name_raw'),
		purchasedAt: timestamp('purchased_at', { withTimezone: true }),
		totalGrossCents: integer('total_gross_cents'),
		currency: text('currency').notNull().default('EUR'),
		paymentMethod: text('payment_method'),
		status: receiptStatus('status').notNull().default('pending'),
		source: receiptSource('source').notNull().default('camera'),
		/**
		 * Vorgabe 'privat', und das BESTAETIGEN teilt.
		 *
		 * Damit faellt der Schutz aus der Vorgabe heraus, statt als Sonderfall im Filter zu
		 * stehen: ein frisch aufgenommener Bon sieht nur, wer ihn hochgeladen hat. Erst beim
		 * Bestaetigen — dem einen Moment, in dem ohnehin ein Mensch hinschaut — wird er
		 * geteilt, es sei denn, der Schalter "privat behalten" steht an. Ein Bon, der nie
		 * bestaetigt wird (auch ein fehlgeschlagener), bleibt privat. Das ist richtig so.
		 *
		 * Eigentuemer ist `uploaded_by`; eine eigene Spalte dafuer waere eine zweite
		 * Wahrheit ueber dieselbe Frage.
		 */
		sichtbarkeit: sichtbarkeit('sichtbarkeit').notNull().default('privat'),
		/**
		 * Was beim BESTAETIGEN gelten soll — null heisst: noch nicht entschieden.
		 *
		 * `sichtbarkeit` sagt, was JETZT gilt; bei einem ungeprueften Bon ist das immer
		 * 'privat', und zwar unabhaengig davon, was der Mensch vorhat. Ohne eine zweite
		 * Spalte gibt es keinen Ort fuer den Vorsatz: wer „privat behalten" ankreuzt und
		 * dann auf „Spaeter" klickt, fand den Schalter beim naechsten Oeffnen wieder aus,
		 * und ein Bestaetigen teilte den Bon gegen die vorher getroffene Entscheidung
		 * (Befund R22).
		 *
		 * Nullable und nicht `default false`: „noch nicht entschieden" und „ausdruecklich
		 * teilen" sind zwei verschiedene Aussagen, und nur die zweite darf den Schalter
		 * beim Wiederoeffnen angekreuzt oder leer zeigen.
		 */
		privatGewuenscht: boolean('privat_gewuenscht'),
		// Idempotenz-Schlüssel für Bons aus Matrix. Nach einem Neustart oder einem
		// erneuten /sync liefert Matrix dieselben Ereignisse noch einmal; ohne diese
		// Bedingung entstünde für jedes Bild ein zweiter Bon. Derselbe Fehler wie in
		// der Offline-Warteschlange und beim fehlgeschlagenen Einreihen — beim dritten
		// Mal vorher verhindert. Nullable, weil Kamera- und Upload-Bons keine haben;
		// Postgres lässt beliebig viele NULL in einer eindeutigen Spalte zu.
		matrixEventId: text('matrix_event_id').unique(),
		imagePath: text('image_path').notNull(),
		thumbPath: text('thumb_path').notNull(),
		/**
		 * Der Bon, von dem dieser vermutlich ein zweites Foto ist — gesetzt vom Worker nach
		 * dem Auslesen (bons/doppelt.ts), geleert, sobald ein Mensch „eigener Einkauf" sagt.
		 * Solange die Spalte gefuellt ist, laesst sich der Bon nicht bestaetigen: sonst
		 * stuende derselbe Einkauf zweimal im Haushaltsbuch, genau der Fall, der den Bau
		 * ausgeloest hat (ALDI 16.09., zweimal bestaetigt).
		 *
		 * ON DELETE SET NULL: verschwindet das Original, gibt es nichts mehr, wovon dieser
		 * Bon eine Kopie sein koennte.
		 */
		vermutetesOriginalId: uuid('vermutetes_original_id').references((): AnyPgColumn => receipts.id, {
			onDelete: 'set null'
		}),
		needsReviewReason: jsonb('needs_review_reason').$type<string[]>(),
		failureReason: text('failure_reason'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
		confirmedBy: uuid('confirmed_by').references(() => users.id)
	},
	(t) => [
		index('receipts_household_status_idx').on(t.householdId, t.status),
		index('receipts_purchased_at_idx').on(t.purchasedAt)
	]
);

export const receiptItems = pgTable(
	'receipt_items',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		receiptId: uuid('receipt_id')
			.notNull()
			.references(() => receipts.id, { onDelete: 'cascade' }),
		lineNo: integer('line_no').notNull(),
		rawText: text('raw_text').notNull(),
		lineType: lineType('line_type').notNull().default('article'),
		quantity: text('quantity'),
		unit: text('unit'),
		unitPriceCents: integer('unit_price_cents'),
		totalPriceCents: integer('total_price_cents').notNull(),
		vatClass: text('vat_class'),
		appliesToLine: integer('applies_to_line'),
		/**
		 * Index der OCR-Zeile in `extraction_runs.ocr_zeilen` des Laufs, der diese
		 * Position erzeugt hat — oder null, wenn sich keine Zeile eindeutig zuordnen
		 * liess. null heisst "nicht zuordenbar", NICHT "Zeile 0": eine falsche
		 * Hervorhebung im Bild waere schlimmer als keine. Die Zuordnung ist eine Hilfe
		 * zum Sehen; sie aendert weder Betraege noch Status (siehe ocr/zuordnung.ts).
		 */
		ocrZeile: integer('ocr_zeile'),
		corrected: boolean('corrected').notNull().default(false),
		productId: uuid('product_id').references(() => products.id, { onDelete: 'set null' }),
		categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'set null' }),
		categorySource: categorySource('category_source'),
		// 0-100. null heisst „keine Aussage“ — etwa bei 'manual', wo Konfidenz
		// bedeutungslos ist. Eine erfundene 100 waere eine Behauptung.
		confidence: integer('confidence')
	},
	(t) => [
		unique('receipt_items_line_unique').on(t.receiptId, t.lineNo),
		// ============ ACHTUNG: VON HAND KORRIGIERTE MIGRATION ============
		// In der Datenbank lautet dieser Constraint
		//     ON DELETE SET NULL (applies_to_line)
		// — MIT Spaltenliste. Drizzle 0.45 kann die nicht ausdruecken; was hier steht,
		// ist die unqualifizierte Fassung. Ohne Spaltenliste nullt Postgres ALLE
		// referenzierenden Spalten, also auch receipt_id (NOT NULL) — dann laesst sich
		// eine referenzierte Bonzeile und damit der ganze Bon NICHT MEHR loeschen.
		//
		// Die Korrektur steht in drizzle/0004_fix_applies_to_line_fk.sql (handgeschrieben,
		// 0004_snapshot.json ist deshalb eine Kopie von 0003). Wer diesen Fremdschluessel
		// anfasst und `npm run db:generate` laufen laesst, erzeugt ein DROP/ADD in der
		// unqualifizierten Form und macht den Fix STILL rueckgaengig.
		// Gegenprobe nach jeder Schemaaenderung:
		//     RUN_DB_TESTS=1 npx vitest run src/lib/server/db/fk-integrity.db.test.ts
		//
		// Zwei weitere handgeschriebene DB-Objekte derselben Art stehen bei den Tabellen
		// categories (Zweistufigkeits-CHECK + Trigger) und productAliases (partieller
		// Unique-Index) weiter unten in diesem File — jeweils mit eigenem ACHTUNG-Block.
		// =================================================================
		foreignKey({
			columns: [t.receiptId, t.appliesToLine],
			foreignColumns: [t.receiptId, t.lineNo],
			name: 'receipt_items_applies_to_line_fk'
		}).onDelete('set null')
	]
);

export const extractionRuns = pgTable('extraction_runs', {
	id: uuid('id').primaryKey().defaultRandom(),
	receiptId: uuid('receipt_id')
		.notNull()
		.references(() => receipts.id, { onDelete: 'cascade' }),
	provider: text('provider').notNull(),
	model: text('model').notNull(),
	// Nur gefuellt, wenn der Anbieter ein ANDERES Modell geliefert hat als angefragt.
	// null heisst: wir haben bekommen, was wir wollten. So ist eine stille Umleitung in
	// den Daten sichtbar, ohne bei jeder Zeile denselben Wert zu wiederholen.
	requestedModel: text('requested_model'),
	// Welcher eingerichtete Anbieter diesen Lauf machte. null = .env, oder der Anbieter
	// wurde spaeter geloescht. Grundlage fuer Kosten/Genauigkeit je Anbieter (Teilprojekt 3).
	kiAnbieterId: uuid('ki_anbieter_id').references(() => kiAnbieter.id, { onDelete: 'set null' }),
	rawJson: jsonb('raw_json'),
	// Aufgabe 3 (Entwurf E5): der OCR-Text, aus dem `rawJson` entstand — null beim
	// Bildweg (kein OCR-Schritt) und beim Bildweg-Vorlauf. Einziger Beleg, WAS
	// Tesseract tatsaechlich gelesen hat; ohne ihn ist bei einem falschen Bon nicht
	// mehr feststellbar, ob die Texterkennung oder das Modell schuld war. Auch bei
	// einem als unlesbar markierten Bon (BonUnlesbarError) gefuellt — dort ist er
	// sogar der einzige Inhalt dieser Zeile, weil kein Modellaufruf stattfand.
	ocrText: text('ocr_text'),
	// Etappe 2 der OCR-Abstraktion: WELCHE Engine diesen Text gelesen hat und unter
	// welchen Bedingungen. Ohne das laesst sich spaeter nicht sagen, ob ein Bon von
	// Tesseract oder PaddleOCR stammt — und damit auch kein Vergleich fuehren, was
	// der ganze Zweck der Abstraktion ist. `null` beim Bildweg: dort lief kein OCR.
	//
	// Die Spalte heisst ocr_ENGINE und nicht ocr_provider, weil `provider` in dieser
	// Tabelle schon etwas anderes meint: den EXTRAKTIONS-Anbieter ("ocr-text",
	// "openai-compat"). Zwei Spalten namens Provider nebeneinander waeren eine
	// Verwechslung, die man erst bemerkt, wenn eine Auswertung falsch ist.
	ocrEngine: text('ocr_engine'),
	ocrEngineVersion: text('ocr_engine_version'),
	// Getrennt von `duration_ms`: das ist die Dauer des MODELLaufrufs. Ob ein Bon lange
	// brauchte, weil die Texterkennung oder weil das Modell langsam war, sind zwei
	// verschiedene Befunde mit zwei verschiedenen Gegenmitteln.
	ocrDurationMs: integer('ocr_duration_ms'),
	// Was der Engine TATSAECHLICH uebergeben wurde (Sprache, psm, Boxen ja/nein) —
	// nicht, was in der Konfiguration stand. Bei PaddleOCR wird hier spaeter die
	// Groessengrenze stehen, und genau die entschied in Etappe 0 darueber, ob zwei
	// Drittel der Artikel gefunden wurden oder nicht.
	ocrOptions: jsonb('ocr_options'),
	/**
	 * Die OCR-Zeilen dieses Laufs — je Zeile Text, Rahmen `[x, y, breite, hoehe]` in
	 * Pixeln des GESPEICHERTEN Bildes und Confidence (0..100, Tesseract-Skala). Etappe 2
	 * der Oberflaechen-Umstellung (2026-09-17): die Grundlage fuer "Zeile im Bild" in der
	 * Pruefansicht. Bis dahin sprang das Bild an eine GERATENE Stelle (Zeile 7 von 20 =
	 * 35 % der Hoehe), weil es keine Koordinaten gab.
	 *
	 * null, wenn der Lauf keine Zeilen hatte: Bildweg (keine OCR), oder OCR ohne
	 * `OCR_INCLUDE_BOXES=true`. Kein leeres Array fuer "keine Boxen angefordert" — das
	 * saehe aus wie "OCR fand keine Zeile".
	 */
	ocrZeilen: jsonb('ocr_zeilen').$type<{ text: string; box: [number, number, number, number]; confidence: number | null }[]>(),
	durationMs: integer('duration_ms'),
	itemCount: integer('item_count'),
	sumMatch: boolean('sum_match'),
	error: text('error'),
	// Rohfakten (Token), nicht die Deutung (Kosten) — Preise ändern sich rückwirkend
	// nie im Sinn dieser Zeile, Tokenzahlen sind ein historisches Faktum des Aufrufs.
	inputTokens: integer('input_tokens'),
	outputTokens: integer('output_tokens'),
	// Kosten des Aufrufs in Millionstel Euro. NICHT in Cent: ein Extraktionsaufruf
	// kostet rund 0,2 Cent und würde auf 0 gerundet. 0,00225 EUR = 2250.
	costMicroEuros: integer('cost_micro_euros'),
	// Anteil der Positionen, die nach der Bestätigung durch einen Menschen exakt
	// stimmten (Preis und Zeilentyp), 0-100. Null, solange nicht ausgewertet.
	accuracyVsConfirmed: integer('accuracy_vs_confirmed'),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

export const matrixLinks = pgTable('matrix_links', {
	id: uuid('id').primaryKey().defaultRandom(),
	// Beidseitig eindeutig: ein Matrix-Konto darf nicht auf zwei App-Nutzer zeigen,
	// und ein App-Nutzer nicht von zwei Matrix-Konten bespielt werden. Ohne das könnte
	// eine zweite Kopplung eine bestehende still überschatten.
	userId: uuid('user_id')
		.notNull()
		.unique()
		.references(() => users.id, { onDelete: 'cascade' }),
	matrixUserId: text('matrix_user_id').notNull().unique(),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

export const matrixPairingCodes = pgTable('matrix_pairing_codes', {
	id: uuid('id').primaryKey().defaultRandom(),
	userId: uuid('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	// Nur der Hash. Der Code ist ein Zugangsmittel: wer ihn hat, kann sein Matrix-Konto
	// an ein fremdes App-Konto binden und Bons einschleusen.
	codeHash: text('code_hash').notNull().unique(),
	expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
	usedAt: timestamp('used_at', { withTimezone: true }),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

// Die Begrenzung hängt am ABSENDER, nicht am Code: Codes werden gehasht nachgeschlagen,
// ein falsch geratener trifft also gar keine Zeile, deren Zähler man erhöhen könnte.
export const matrixPairingAttempts = pgTable('matrix_pairing_attempts', {
	matrixUserId: text('matrix_user_id').primaryKey(),
	failedCount: integer('failed_count').notNull().default(0),
	windowStartedAt: timestamp('window_started_at', { withTimezone: true }).notNull().defaultNow()
});

// Genau eine Zeile, id = 1. Der Sync-Token gehört in die Datenbank und nicht in eine
// Datei im Container: dort begänne der Bot nach jedem `docker compose up` von vorn und
// arbeitete den ganzen Verlauf noch einmal durch.
export const matrixBotState = pgTable('matrix_bot_state', {
	id: integer('id').primaryKey().default(1),
	sinceToken: text('since_token'),
	lastSyncAt: timestamp('last_sync_at', { withTimezone: true })
});

export const categories = pgTable('categories', {
	id: uuid('id').primaryKey().defaultRandom(),
	// null = Oberkategorie. Die Zweistufigkeit ist laut Entwurf fest; tiefere
	// Verschachtelung wird nicht unterstuetzt und soll auch nicht entstehen.
	//
	// ============ ACHTUNG: VON HAND ERGAENZTE DB-OBJEKTE AUSSERHALB DRIZZLE ============
	// Das FK unten (categories_parent_id_categories_id_fk) prueft nur, dass der
	// referenzierte Datensatz existiert — NICHT, dass daraus kein Zyklus und keine
	// dritte Ebene entsteht. Zwei zusaetzliche, handgeschriebene DB-Objekte erzwingen
	// die Zweistufigkeit, weil Drizzle 0.45 weder einen zeilenuebergreifenden CHECK
	// noch einen Trigger ausdruecken kann:
	//   - CHECK "categories_parent_not_self" (parent_id <> id) gegen Selbstreferenz.
	//   - TRIGGER categories_enforce_two_levels_trg (Funktion
	//     fn_categories_enforce_two_levels) lehnt INSERT/UPDATE ab, wenn der
	//     angegebene Elternknoten selbst schon einen Elternknoten hat, ODER wenn der
	//     zu aendernde Knoten bereits eigene Unterkategorien hat.
	// Beide stehen in drizzle/0010_categories_two_level_guard.sql und NIRGENDS in
	// diesem File — wer diese Tabelle umbaut (z.B. ein `db:generate` nach einer
	// Schemaaenderung laufen laesst), sieht sie hier nicht automatisch und MUSS sie
	// mitdenken; `db:generate` kann sie weder anzeigen noch zurueckdrehen, da sie kein
	// Gegenstueck in schema.ts haben. Gegenprobe nach jeder Schemaaenderung:
	//     RUN_DB_TESTS=1 npx vitest run src/lib/server/db/fk-integrity.db.test.ts
	// =================================================================================
	parentId: uuid('parent_id').references((): AnyPgColumn => categories.id, {
		onDelete: 'restrict'
	}),
	name: text('name').notNull(),
	// Stabiler Schluessel, damit der Startbestand idempotent eingespielt werden kann
	// und eine Umbenennung keine Zuordnungen zerreisst.
	slug: text('slug').notNull().unique(),
	sort: integer('sort').notNull().default(0),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

export const products = pgTable('products', {
	id: uuid('id').primaryKey().defaultRandom(),
	// Pro Haushalt, nicht global: Produktnamen sind eine persoenliche Konvention
	// (siehe Entwurf). Haendler dagegen sind objektive Tatsachen und global.
	householdId: uuid('household_id')
		.notNull()
		.references(() => households.id, { onDelete: 'cascade' }),
	canonicalName: text('canonical_name').notNull(),
	brand: text('brand'),
	defaultCategoryId: uuid('default_category_id').references(() => categories.id, {
		onDelete: 'set null'
	}),
	defaultUnit: text('default_unit'),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

export const productAliases = pgTable(
	'product_aliases',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		productId: uuid('product_id')
			.notNull()
			.references(() => products.id, { onDelete: 'cascade' }),
		// null = haendlerunabhaengig gelernt. Die Eindeutigkeit unten laesst dann
		// mehrere solcher Zeilen zu; Postgres behandelt NULL als verschieden. Das ist
		// gewollt: haendlerunabhaengige Regeln sind Stufe 2 und schwaecher.
		//
		// ============ ACHTUNG: VON HAND ERGAENZTES DB-OBJEKT AUSSERHALB DRIZZLE ============
		// "Verschieden" gilt auch INNERHALB von merchant_id=NULL: der zusammengesetzte
		// Unique-Constraint unten (['merchantId', 'rawTextNormalized']) greift NICHT,
		// wenn merchant_id NULL ist — mehrere NULLs sind fuer Postgres nie gleich. Ohne
		// weitere Sperre liessen sich beliebig viele Alias-Zeilen mit demselben Rohtext
		// auf UNTERSCHIEDLICHE Produkte anlegen, sobald der Haendler unbekannt ist
		// (haeufiger Fall, kein Ausnahmefall). Ein zusaetzlicher PARTIELLER Unique-Index
		// deckt genau diesen Fall ab:
		//     CREATE UNIQUE INDEX product_aliases_raw_text_no_merchant_unique
		//       ON product_aliases (raw_text_normalized) WHERE merchant_id IS NULL;
		// Drizzle 0.45 kann die WHERE-Klausel nicht ausdruecken — der Index steht
		// handgeschrieben in drizzle/0009_product_aliases_null_merchant_unique.sql und
		// NIRGENDS in diesem File. `db:generate` sieht ihn nicht und kann ihn weder
		// anzeigen noch zurueckdrehen. Gegenprobe nach jeder Schemaaenderung:
		//     RUN_DB_TESTS=1 npx vitest run src/lib/server/db/fk-integrity.db.test.ts
		// =================================================================================
		merchantId: uuid('merchant_id').references(() => merchants.id, { onDelete: 'cascade' }),
		rawTextNormalized: text('raw_text_normalized').notNull(),
		hits: integer('hits').notNull().default(1),
		createdFrom: text('created_from').notNull().default('manual'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [unique('product_aliases_merchant_text_unique').on(t.merchantId, t.rawTextNormalized)]
);

export const productTags = pgTable(
	'product_tags',
	{
		productId: uuid('product_id')
			.notNull()
			.references(() => products.id, { onDelete: 'cascade' }),
		tag: text('tag').notNull()
	},
	(t) => [primaryKey({ columns: [t.productId, t.tag] })]
);

// =====================================================================================
// Budgets (Oberflaeche, Etappe 5 — Entwurf 2026-09-17 §7)
// =====================================================================================

/**
 * Ein Topf. Kategorien sind global, Budgets gehoeren dem Haushalt: „Lebensmittel"
 * heisst ueberall dasselbe, aber wie viel dafuer vorgesehen ist, ist die Sache des
 * jeweiligen Haushalts.
 */
export const budgets = pgTable('budgets', {
	id: uuid('id').primaryKey().defaultRandom(),
	householdId: uuid('household_id')
		.notNull()
		.references(() => households.id, { onDelete: 'cascade' }),
	name: text('name').notNull(),
	/**
	 * Ab wann der Topf nicht mehr gilt — null heisst: er gilt.
	 *
	 * Ein geloeschter Topf wird NICHT entfernt: sein Name und seine Betraege werden fuer
	 * vergangene Berichte noch gebraucht. Ohne diese Spalte waere er aber von einem
	 * frisch angelegten nicht zu unterscheiden — beide haetten weder Zuordnung noch
	 * Betrag. Ein Datum, kein Zeitpunkt, aus demselben Grund wie bei `gilt_ab`.
	 */
	geloeschtAb: date('geloescht_ab'),
	/**
	 * Anders als beim Bon ist die Vorgabe hier 'geteilt'.
	 *
	 * Ein Topf wird bewusst angelegt, und der Normalfall ist der gemeinsame
	 * Haushaltstopf. Beim Bon ist es umgekehrt: der entsteht beilaeufig mit einem Foto,
	 * und dort muss die Vorgabe schmusterstadtn. Hier waere sie nur im Weg.
	 */
	sichtbarkeit: sichtbarkeit('sichtbarkeit').notNull().default('geteilt'),
	/** Nur bei 'privat' gesetzt — siehe CHECK in der Migration. */
	eigentuemerId: uuid('eigentuemer_id').references(() => users.id),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

/**
 * Der Betrag eines Topfs, gueltig ab einem Monatsersten.
 *
 * Kein einzelnes `amount_cents` am Topf, sondern eine Reihe ueber die Zeit: steigt das
 * Lebensmittelbudget im Oktober, darf das den Septemberbericht nicht rueckwirkend
 * veraendern. Der Bericht nimmt je Monat den Betrag, der an dessen Erstem galt.
 */
export const budgetBetraege = pgTable(
	'budget_betraege',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		budgetId: uuid('budget_id')
			.notNull()
			.references(() => budgets.id, { onDelete: 'cascade' }),
		/** Immer der 1. eines Monats. */
		giltAb: date('gilt_ab').notNull(),
		amountCents: integer('amount_cents').notNull()
	},
	(t) => [unique('budget_betraege_ab_unique').on(t.budgetId, t.giltAb)]
);

/**
 * Welche Kategorie zu welchem Topf gehoert — ebenfalls mit Zeitraum.
 *
 * `household_id` steht hier, obwohl er ueber den Topf schon bekannt waere. Grund ist die
 * Regel darunter: eine Kategorie gehoert zu einer Zeit hoechstens EINEM Topf, und zwar
 * je Haushalt (Kategorien sind geteilt). Postgres kann eine Teilregel nicht ueber einen
 * Verbund ausdruecken, also muss die Spalte in derselben Tabelle liegen.
 *
 * Ober- und Unterkategorien werden gleich behandelt: ein Topf kann „Haushalt" ganz
 * nehmen oder nur „Reinigung". Nimmt er die Oberkategorie, gelten deren
 * Unterkategorien mit — sofern sie nicht selbst anderswo zugeordnet sind. Der genauere
 * Eintrag gewinnt. Das entscheidet die Aufloesung (server/budgets/aufloesung.ts), nicht
 * die Datenbank; hier steht nur, was ausdruecklich zugeordnet wurde.
 *
 * Ein geloeschter Topf setzt `gilt_bis`, statt Zeilen zu entfernen: vergangene Berichte
 * bleiben, wie sie waren.
 */
export const budgetKategorien = pgTable(
	'budget_kategorien',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		budgetId: uuid('budget_id')
			.notNull()
			.references(() => budgets.id, { onDelete: 'cascade' }),
		householdId: uuid('household_id')
			.notNull()
			.references(() => households.id, { onDelete: 'cascade' }),
		categoryId: uuid('category_id')
			.notNull()
			.references(() => categories.id, { onDelete: 'cascade' }),
		giltAb: date('gilt_ab').notNull(),
		/** null = gilt weiter. */
		giltBis: date('gilt_bis'),
		/**
		 * DUPLIKAT von `budgets.eigentuemer_id` — aus demselben Grund, aus dem
		 * `household_id` hier schon steht: die Regel darunter ist eine Teilregel ueber
		 * EINE Tabelle, und Postgres kann eine solche nicht ueber einen Verbund
		 * ausdruecken. Die Uebereinstimmung mit dem Topf prueft der FK-Integritaetstest,
		 * weil ein CHECK nur Spalten derselben Zeile vergleichen kann.
		 */
		eigentuemerId: uuid('eigentuemer_id').references(() => users.id)
	},
	() => [
		// ============ ACHTUNG: DER AKTIVE UNIQUE-INDEX STEHT NICHT MEHR HIER ============
		// `budget_kategorien_aktiv_unique` lag bis 18.09.2026 an dieser Stelle, auf
		// (household_id, category_id) WHERE gilt_bis IS NULL. Mit privaten Toepfen ist das
		// zu streng: haetten zwei Mitglieder je einen privaten Topf "Geschenke", lehnte
		// Postgres den zweiten ab — mit einer Meldung, aus der niemand liest, warum. Der
		// Eigentuemer gehoert deshalb in den Schluessel.
		//
		// Der Index braucht dabei NULLS NOT DISTINCT: geteilte Toepfe haben
		// eigentuemer_id IS NULL, und Postgres behandelt NULLs sonst als verschieden —
		// zwei geteilte Toepfe koennten dieselbe Kategorie beanspruchen, also genau das,
		// was der Index verhindern soll. Postgres 18 kann das; Drizzle 0.45 kann es nicht
		// ausdruecken. Der Index steht darum in drizzle/0023_budget_kategorien_eigentuemer.sql
		// und NIRGENDS in diesem File. Wer hier etwas umbaut (z.B. `db:generate` laufen
		// laesst), sieht ihn nicht automatisch und MUSS ihn mitdenken.
		// Gegenprobe:
		//     RUN_DB_TESTS=1 npx vitest run src/lib/server/db/fk-integrity.db.test.ts
		// ================================================================================
	]
);

/**
 * Was der Betreiber getan hat. `details` traegt nur Namen, IDs und alt/neu — NIE einen
 * Schluessel und NIE Inhalte aus einem Haushalt. Die Anwendung bietet keinen Weg,
 * Eintraege zu aendern oder zu loeschen.
 */
export const betriebsprotokoll = pgTable(
	'betriebsprotokoll',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		zeit: timestamp('zeit', { withTimezone: true }).notNull().defaultNow(),
		userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
		aktion: text('aktion').notNull(),
		ziel: text('ziel'),
		details: jsonb('details').$type<Record<string, unknown>>()
	},
	(t) => [index('betriebsprotokoll_zeit_idx').on(t.zeit)]
);
