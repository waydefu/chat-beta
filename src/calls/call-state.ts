export type ClientCallPhase =
  | 'idle'
  | 'creating'
  | 'connecting'
  | 'ringing'
  | 'active'
  | 'reconnecting'
  | 'ending'
  | 'ended'
  | 'failed';

const TRANSITIONS: Record<ClientCallPhase, ReadonlySet<ClientCallPhase>> = {
  idle: new Set(['creating', 'connecting']),
  creating: new Set(['connecting', 'ending', 'failed']),
  connecting: new Set(['ringing', 'active', 'reconnecting', 'ending', 'failed']),
  ringing: new Set(['active', 'reconnecting', 'ending', 'failed']),
  active: new Set(['reconnecting', 'ending', 'failed']),
  reconnecting: new Set(['ringing', 'active', 'ending', 'failed']),
  ending: new Set(['ended', 'failed']),
  ended: new Set(['idle']),
  failed: new Set(['idle']),
};

export function transitionCallPhase(current: ClientCallPhase, next: ClientCallPhase): ClientCallPhase {
  if (current === next) return current;
  if (!TRANSITIONS[current].has(next)) throw new Error(`Invalid call transition: ${current} -> ${next}`);
  return next;
}

export function callPhaseLabel(phase: ClientCallPhase): string {
  const labels: Record<ClientCallPhase, string> = {
    idle: '尚未通話',
    creating: '建立通話',
    connecting: '正在連線',
    ringing: '等待對方',
    active: '通話中',
    reconnecting: '重新連線',
    ending: '正在結束通話',
    ended: '通話結束',
    failed: '連線失敗',
  };
  return labels[phase];
}
