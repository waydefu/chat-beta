import { describe, expect, it } from 'vitest';

import { offlineStartupState } from '../src/firebase/offline-policy';

describe('trusted offline cache policy', () => {
  it('requires explicit opt-in', () => {
    expect(offlineStartupState(null, null)).toEqual({
      preferred: false, persistent: false, revocationPending: false,
    });
    expect(offlineStartupState('true', null).persistent).toBe(true);
  });

  it('fails closed to memory cache while revocation is pending', () => {
    expect(offlineStartupState('true', 'true')).toEqual({
      preferred: true, persistent: false, revocationPending: true,
    });
    expect(offlineStartupState('false', 'true').persistent).toBe(false);
  });

  it('marks the legacy explicit-off preference for one-time cleanup', () => {
    expect(offlineStartupState('false', null, null).revocationPending).toBe(true);
    expect(offlineStartupState('false', null, 'complete').revocationPending).toBe(false);
    expect(offlineStartupState(null, null, null).revocationPending).toBe(false);
  });
});
