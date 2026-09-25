import { describe, it, expect } from 'vitest';
import { generateSessionId, isExpired } from './session';

describe('Session-Grundlagen', () => {
  it('erzeugt ausreichend lange, eindeutige Ids', () => {
    const a = generateSessionId();
    const b = generateSessionId();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(32);
  });
  it('erkennt abgelaufene Sessions', () => {
    expect(isExpired(new Date(Date.now() - 1000))).toBe(true);
  });
  it('erkennt gültige Sessions', () => {
    expect(isExpired(new Date(Date.now() + 60_000))).toBe(false);
  });
});
