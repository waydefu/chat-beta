import { describe, expect, it } from 'vitest';

import {
  connectionStatusView,
  escalateConnectionState,
  INITIAL_CONNECTION_STATE,
  nextConnectionState,
  RECONNECT_GRACE_MS,
  type RealtimeConnectionEvent,
  type RealtimeConnectionState,
} from '../src/realtime/connection-status';

function drive(events: RealtimeConnectionEvent[], from = INITIAL_CONNECTION_STATE): RealtimeConnectionState {
  return events.reduce(nextConnectionState, from);
}

const open: RealtimeConnectionEvent = { type: 'opening' };
const established: RealtimeConnectionEvent = { type: 'established' };
const up = (at: number): RealtimeConnectionEvent => ({ type: 'socket', connected: true, at });
const down = (at: number): RealtimeConnectionEvent => ({ type: 'socket', connected: false, at });

describe('realtime connection status', () => {
  it('starts idle and only claims connected once the room session exists', () => {
    expect(INITIAL_CONNECTION_STATE.phase).toBe('idle');
    expect(drive([open]).phase).toBe('connecting');
    // The socket being up is not the same as this room being subscribed, which
    // is exactly the conflation that made the header permanently optimistic.
    expect(drive([open, up(0)]).phase).toBe('connecting');
    expect(drive([open, established]).phase).toBe('connected');
  });

  it('does not flash a failure while the first connection is still pending', () => {
    // A cold start reports the socket down before it comes up. Showing that as
    // an outage would make every load flicker through an error state.
    expect(drive([open, down(0)]).phase).toBe('connecting');
    expect(drive([open, down(0), down(500)]).phase).toBe('connecting');
    expect(drive([open, down(0), established]).phase).toBe('connected');
  });

  it('reports a dropped socket as reconnecting, then escalates once the grace window closes', () => {
    const dropped = drive([open, established, down(1_000)]);
    expect(dropped).toMatchObject({ phase: 'reconnecting', downSince: 1_000 });
    // A blip inside the window is still just a blip.
    expect(escalateConnectionState(dropped, 1_000 + RECONNECT_GRACE_MS - 1).phase).toBe('reconnecting');
    // Beyond it, the debounce must not keep hiding a real disconnect.
    expect(escalateConnectionState(dropped, 1_000 + RECONNECT_GRACE_MS).phase).toBe('offline');
  });

  it('keeps the original outage start across repeated down events', () => {
    const state = drive([open, established, down(1_000), down(4_000), down(7_000)]);
    expect(state).toMatchObject({ phase: 'reconnecting', downSince: 1_000 });
  });

  it('returns to connected when the socket comes back, from either outage phase', () => {
    expect(drive([open, established, down(1_000), up(2_000)]).phase).toBe('connected');
    const offline = escalateConnectionState(drive([open, established, down(1_000)]), 99_000);
    expect(offline.phase).toBe('offline');
    expect(nextConnectionState(offline, up(100_000)).phase).toBe('connected');
  });

  it('does not let a socket event paint over an authorization failure', () => {
    const denied = drive([open, established, { type: 'unauthorized' }]);
    expect(denied.phase).toBe('unauthorized');
    expect(nextConnectionState(denied, up(1_000)).phase).toBe('unauthorized');
    expect(nextConnectionState(denied, down(1_000)).phase).toBe('unauthorized');
    // Only opening a room clears it.
    expect(nextConnectionState(denied, open).phase).toBe('connecting');
  });

  it('resets to idle on close so the next room cannot inherit this one status', () => {
    const state = drive([open, established, { type: 'closed' }]);
    expect(state).toBe(INITIAL_CONNECTION_STATE);
    expect(connectionStatusView(state).tone).toBe('neutral');
  });

  it('reopening after an outage starts from connecting, not from the stale phase', () => {
    const stale = escalateConnectionState(drive([open, established, down(0)]), RECONNECT_GRACE_MS);
    expect(stale.phase).toBe('offline');
    expect(drive([{ type: 'closed' }, open], stale).phase).toBe('connecting');
  });

  it('describes realtime sync rather than the whole service, and marks only connected as healthy', () => {
    const phases = ['idle', 'connecting', 'connected', 'reconnecting', 'offline', 'unauthorized'] as const;
    for (const phase of phases) {
      const view = connectionStatusView({ phase, downSince: null });
      expect(view.label.startsWith('即時同步')).toBe(true);
      expect(view.tone === 'online').toBe(phase === 'connected');
    }
  });

  it('is stable when nothing changed, so the header is not rewritten on every beat', () => {
    const connected = drive([open, established]);
    expect(nextConnectionState(connected, established)).toBe(connected);
    expect(nextConnectionState(connected, up(5_000))).toBe(connected);
    const reconnecting = nextConnectionState(connected, down(5_000));
    expect(nextConnectionState(reconnecting, down(6_000))).toBe(reconnecting);
    expect(escalateConnectionState(connected, 1_000_000)).toBe(connected);
  });
});
