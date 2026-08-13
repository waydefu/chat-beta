import { callFunction } from '../firebase/callables';
import type { CallParticipant, CallProvider, CallSession } from './providers/call-provider';

export interface StartCallRequest {
  roomId: string;
  kind: 'voice' | 'video';
  stage: HTMLElement;
  onParticipants(participants: CallParticipant[]): void;
}

export async function startCall(
  provider: CallProvider,
  request: StartCallRequest,
  signal: AbortSignal,
): Promise<{ callId: string; session: CallSession }> {
  const response = await callFunction<{ roomId: string; kind: string }, { callId: string }>(
    'startLiveKitCall',
    { roomId: request.roomId, kind: request.kind },
    { limitedUseAppCheckTokens: true },
  );
  const session = await provider.join({
    roomId: request.roomId,
    callId: response.callId,
    audio: true,
    video: request.kind === 'video',
    stage: request.stage,
    onParticipants: request.onParticipants,
  }, signal);
  return { callId: response.callId, session };
}

export async function endCall(roomId: string, callId: string): Promise<void> {
  await callFunction('endLiveKitCall', { roomId, callId });
}
