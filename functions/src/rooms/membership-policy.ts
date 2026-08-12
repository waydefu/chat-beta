export interface MembershipState {
  status?: unknown;
  version?: unknown;
}

export interface OperationState {
  action?: unknown;
  state?: unknown;
  version?: unknown;
}

export function shouldHaveRealtimeMirror(
  membership: MembershipState | undefined,
  operation: OperationState | undefined,
): boolean {
  if (membership?.status !== 'active') return false;
  if (operation?.action === 'revoke' && operation.state !== 'complete') return false;
  const memberVersion = Number(membership.version || 0);
  const operationVersion = Number(operation?.version || 0);
  return !(operation?.action === 'revoke' && operationVersion >= memberVersion);
}

export function mirrorTransitionAllowed(
  prior: { status?: unknown; version?: unknown } | undefined,
  nextVersion: number,
  action: 'activate' | 'revoke',
): boolean {
  if (!Number.isSafeInteger(nextVersion) || nextVersion < 0) return false;
  const priorVersion = Number(prior?.version || 0);
  if (priorVersion > nextVersion) return false;
  return !(action === 'activate' && prior?.status === 'revoked' && priorVersion >= nextVersion);
}
