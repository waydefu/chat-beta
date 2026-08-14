import { describe, expect, it } from 'vitest';

import { callPhaseLabel, transitionCallPhase } from '../src/calls/call-state';

describe('client call state machine', () => {
  it('follows creating, connecting, ringing, active and ending explicitly', () => {
    let phase = transitionCallPhase('idle', 'creating');
    phase = transitionCallPhase(phase, 'connecting');
    phase = transitionCallPhase(phase, 'ringing');
    phase = transitionCallPhase(phase, 'active');
    phase = transitionCallPhase(phase, 'ending');
    phase = transitionCallPhase(phase, 'ended');
    expect(phase).toBe('ended');
  });

  it('supports reconnect recovery without resetting elapsed call state', () => {
    expect(transitionCallPhase('active', 'reconnecting')).toBe('reconnecting');
    expect(transitionCallPhase('reconnecting', 'active')).toBe('active');
    expect(callPhaseLabel('reconnecting')).toBe('重新連線');
  });

  it('fails closed on impossible transitions', () => {
    expect(() => transitionCallPhase('idle', 'active')).toThrow('Invalid call transition');
    expect(() => transitionCallPhase('ended', 'active')).toThrow('Invalid call transition');
  });
});
