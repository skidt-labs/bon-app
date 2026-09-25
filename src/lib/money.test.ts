import { describe, it, expect } from 'vitest';
import { parseAmountToCents, formatCents } from './money';

describe('parseAmountToCents', () => {
  it('liest deutsches Komma-Format', () => {
    expect(parseAmountToCents('1,09')).toBe(109);
  });
  it('liest Tausenderpunkt', () => {
    expect(parseAmountToCents('1.234,56')).toBe(123456);
  });
  it('liest negative Beträge (Rabattzeilen)', () => {
    expect(parseAmountToCents('-0,50')).toBe(-50);
  });
  it('ignoriert Währungszeichen und Leerraum', () => {
    expect(parseAmountToCents(' 2,49 EUR ')).toBe(249);
  });
  it('wirft bei unlesbarem Text', () => {
    expect(() => parseAmountToCents('ABC')).toThrow();
  });
  it('wirft bei ziffernhaltigem Nicht-Betrag', () => {
    expect(() => parseAmountToCents('MwSt 19%')).toThrow();
    // Korrigiert gegenüber der im Review mitgelieferten Test-Vorlage: dort stand
    // `.not.toThrow()` mit dem Kommentar "reine Ziffern sind ein gültiger Betrag" — aber
    // "EAN 4006381333931" ist nicht reine Ziffern, es enthält "EAN " (Buchstaben + Leerzeichen).
    // Der Fließtext des Reviews sagt explizit "EAN 4006381333931 must throw only because of the
    // letters and space", was dieser Assertion entspricht. Siehe Fix-Report für Details.
    expect(() => parseAmountToCents('EAN 4006381333931')).toThrow();
  });
  it('wirft bei mehrdeutigen Trennzeichen', () => {
    expect(() => parseAmountToCents('1,234,56')).toThrow();
    expect(() => parseAmountToCents('1.2.3')).toThrow();
  });
  it('wirft bei leerer oder unvollständiger Eingabe', () => {
    expect(() => parseAmountToCents('')).toThrow();
    expect(() => parseAmountToCents('-')).toThrow();
  });
  it('wirft bei mehr als zwei Nachkommastellen', () => {
    expect(() => parseAmountToCents('1,005')).toThrow();
  });
  it('liest Tausendergruppen ohne Nachkommastellen als ganze Euro', () => {
    expect(parseAmountToCents('1.234')).toBe(123400);
  });
  it('liest Punkt-Dezimalschreibweise', () => {
    expect(parseAmountToCents('12.34')).toBe(1234);
  });
});

describe('formatCents', () => {
  it('formatiert deutsch', () => {
    expect(formatCents(123456)).toBe('1.234,56');
  });
  it('formatiert negative Beträge', () => {
    expect(formatCents(-50)).toBe('-0,50');
  });
});
