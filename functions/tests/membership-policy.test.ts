import { describe, expect, it } from 'vitest';

import { mirrorTransitionAllowed, shouldHaveRealtimeMirror } from '../src/rooms/membership-policy.js';

describe('fail-closed membership mirror policy', () => {
  it('mirrors only canonical active membership', () => {
    expect(shouldHaveRealtimeMirror({ status: 'active', version: 2 }, { action: 'activate', state: 'complete', version: 2 })).toBe(true);
    expect(shouldHaveRealtimeMirror({ status: 'revoking', version: 3 }, { action: 'revoke', state: 'pending', version: 3 })).toBe(false);
    expect(shouldHaveRealtimeMirror(undefined, { action: 'revoke', state: 'complete', version: 3 })).toBe(false);
  });

  it('never rebuilds a mirror while a revocation is pending', () => {
    expect(shouldHaveRealtimeMirror(
      { status: 'active', version: 4 },
      { action: 'revoke', state: 'pending', version: 5 },
    )).toBe(false);
  });

  it('rejects stale add events after a newer removal version', () => {
    expect(mirrorTransitionAllowed({ status: 'revoked', version: 5 }, 4, 'activate')).toBe(false);
    expect(mirrorTransitionAllowed({ status: 'revoked', version: 5 }, 5, 'activate')).toBe(false);
    expect(mirrorTransitionAllowed({ status: 'revoked', version: 5 }, 6, 'activate')).toBe(true);
    expect(mirrorTransitionAllowed({ status: 'active', version: 6 }, 5, 'revoke')).toBe(false);
  });
});
