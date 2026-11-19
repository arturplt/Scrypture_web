import { describe, expect, it } from 'vitest';
import { planSync } from './syncPlan';

const A = '2026-11-18T10:00:00+00:00', B = '2026-11-18T11:00:00+00:00';

describe('planSync', () => {
  it('uploads when the account has no save yet', () => {
    expect(planSync({ remote: null, base: null, dirty: true, untouched: false })).toBe('push');
    expect(planSync({ remote: null, base: A, dirty: false, untouched: false })).toBe('push');
  });
  it('does nothing when neither side changed, pushes when only this device did', () => {
    expect(planSync({ remote: A, base: A, dirty: false, untouched: false })).toBe('none');
    expect(planSync({ remote: A, base: A, dirty: true, untouched: false })).toBe('push');
  });
  it('takes the cloud copy when only the cloud changed', () => {
    expect(planSync({ remote: B, base: A, dirty: false, untouched: false })).toBe('pull');
  });
  it('combines when both sides changed', () => {
    expect(planSync({ remote: B, base: A, dirty: true, untouched: false })).toBe('merge');
  });
  it('first sign-in: a fresh device takes the cloud save, a used one combines', () => {
    expect(planSync({ remote: A, base: null, dirty: true, untouched: true })).toBe('pull');
    expect(planSync({ remote: A, base: null, dirty: true, untouched: false })).toBe('merge');
  });
});
