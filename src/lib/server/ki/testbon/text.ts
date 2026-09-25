/**
 * Ein ERFUNDENER Bon fuer den Testknopf in /betrieb/ki. Kein echter Haendler, keine echte
 * Adresse — der Betreiber darf keinen echten Bon sehen, also testet er an diesem.
 * Die Positionen summieren sich zu TESTBON_SUMME_CENTS; stimmt die Summe des Modells
 * damit ueberein, hat es den Bon verstanden.
 */
export const TESTBON_SUMME_CENTS = 1037;

export const TESTBON_TEXT = [
	'TESTMARKT BEISPIELSTADT',
	'Musterstrasse 1, 12345 Beispielstadt',
	'',
	'Vollmilch 3,5% 1l           1,19 A',
	'Bananen lose                1,78 A',
	'Roggenbrot 750g             2,49 A',
	'Butter 250g                 2,29 A',
	'Spuelmittel 500ml           1,65 B',
	'Mineralwasser 1,5l          0,49 B',
	'Pfand                       0,25 B',
	'Gouda gerieben 200g         0,23 A',
	'',
	'SUMME EUR                  10,37',
	'Karte                      10,37',
	'',
	'MwSt  A 7%   netto 7,22  MwSt 0,51',
	'MwSt  B 19%  netto 2,01  MwSt 0,38',
	'23.09.2026 10:15   Kasse 1   Bon 0001'
].join('\n');
