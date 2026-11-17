import { afterEach, describe, expect, it, vi } from 'vitest';
import { newId } from './id';

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
afterEach(() => vi.unstubAllGlobals());

describe('newId', () => {
  it('uses crypto.randomUUID when available', () => {
    expect(newId()).toMatch(V4);
  });
  it('works in an insecure context: crypto without randomUUID (http://192.168.x.x)', () => {
    vi.stubGlobal('crypto', { getRandomValues: (a: Uint8Array) => { for (let i = 0; i < a.length; i++) a[i] = (i * 37 + 11) & 255; return a; } });
    expect(newId()).toMatch(V4);
  });
  it('works with no crypto at all', () => {
    vi.stubGlobal('crypto', undefined);
    expect(newId()).toMatch(V4);
  });
  it('ids are unique', () => {
    vi.stubGlobal('crypto', { getRandomValues: (a: Uint8Array) => { for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256); return a; } });
    expect(new Set(Array.from({ length: 2000 }, newId)).size).toBe(2000);
  });
});
