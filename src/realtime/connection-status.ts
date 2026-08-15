/**
 * The header status describes one thing: whether the realtime mirror (RTDB) is
 * currently synchronising for the open room. It is deliberately not a health
 * indicator for Chat Lite as a whole — Firestore, the callables and the message
 * list all keep working while this says `offline`, and saying otherwise would
 * send users to the wrong place when something breaks.
 */
export type RealtimeConnectionPhase =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'offline'
  | 'unauthorized';

export interface RealtimeConnectionState {
  phase: RealtimeConnectionPhase;
  /** When the current outage started, so a brief blip can be told from a real one. */
  downSince: number | null;
}

/**
 * A dropped socket is shown as `reconnecting` for this long before it escalates
 * to `offline`. The window absorbs the blips the SDK recovers from on its own,
 * which is why it exists at all; letting it run longer would start hiding real
 * disconnects, which is the failure this whole status was added to surface.
 */
export const RECONNECT_GRACE_MS = 8_000;

export type RealtimeConnectionEvent =
  /** A room is opening: the previous room's status must not survive this. */
  | { type: 'opening' }
  /** `connectRealtimeRoom` resolved — the room nodes are written and watched. */
  | { type: 'established' }
  | { type: 'socket'; connected: boolean; at: number }
  /** Rules rejected the room subscription, or the session could not be built. */
  | { type: 'unauthorized' }
  | { type: 'closed' };

export const INITIAL_CONNECTION_STATE: RealtimeConnectionState = { phase: 'idle', downSince: null };

const CONNECTING: RealtimeConnectionState = { phase: 'connecting', downSince: null };
const CONNECTED: RealtimeConnectionState = { phase: 'connected', downSince: null };

export function nextConnectionState(
  current: RealtimeConnectionState,
  event: RealtimeConnectionEvent,
): RealtimeConnectionState {
  switch (event.type) {
    case 'opening':
      return CONNECTING;
    case 'closed':
      return INITIAL_CONNECTION_STATE;
    case 'unauthorized':
      return { phase: 'unauthorized', downSince: null };
    case 'established':
      // A room that authorised after a failure is genuinely connected again.
      return CONNECTED;
    case 'socket':
      // Nothing the socket reports can clear an authorization failure; only a
      // fresh room open can. Otherwise a reconnect would paint over a denial.
      if (current.phase === 'unauthorized') return current;
      // Before the first `established`, the socket is not yet the thing being
      // waited on: showing a failure here makes every cold start flash an error.
      if (current.phase === 'idle' || current.phase === 'connecting') return current;
      if (event.connected) return CONNECTED;
      return current.phase === 'reconnecting' || current.phase === 'offline'
        ? current
        : { phase: 'reconnecting', downSince: event.at };
  }
}

/**
 * Escalation is time-driven, so it cannot be folded into the event reducer: the
 * socket emits nothing while it stays down. The caller re-evaluates on a timer.
 */
export function escalateConnectionState(
  current: RealtimeConnectionState,
  now: number,
): RealtimeConnectionState {
  if (current.phase !== 'reconnecting' || current.downSince === null) return current;
  return now - current.downSince >= RECONNECT_GRACE_MS
    ? { phase: 'offline', downSince: current.downSince }
    : current;
}

export interface ConnectionStatusView {
  label: string;
  /** Maps onto the existing `.status-dot` modifiers. */
  tone: 'neutral' | 'pending' | 'online' | 'warn' | 'down';
}

const VIEWS: Record<RealtimeConnectionPhase, ConnectionStatusView> = {
  idle: { label: '即時同步 · 待連線', tone: 'neutral' },
  connecting: { label: '即時同步 · 連線中', tone: 'pending' },
  connected: { label: '即時同步 · 已連線', tone: 'online' },
  reconnecting: { label: '即時同步 · 重新連線中', tone: 'warn' },
  offline: { label: '即時同步 · 已中斷', tone: 'down' },
  unauthorized: { label: '即時同步 · 未授權', tone: 'down' },
};

export function connectionStatusView(state: RealtimeConnectionState): ConnectionStatusView {
  return VIEWS[state.phase];
}
