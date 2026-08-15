export interface CallParticipant {
  identity: string;
  name: string;
}

export type CallTransportState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

import type { CallTimingRecorder } from '../call-timing';

export interface CallJoinOptions {
  roomId: string;
  callId: string;
  audio: boolean;
  video: boolean;
  /** Optional stage recorder; the provider owns the transport-side stages. */
  timeline?: CallTimingRecorder;
  /**
   * Where the provider attaches video elements. The caller owns the surrounding
   * panel - its controls, drag behaviour and participant list - so that the
   * provider stays a transport and the chrome stays testable without a room.
   */
  stage: HTMLElement;
  /** Remote participants only, reported on connect and on every change. */
  onParticipants(participants: CallParticipant[]): void;
  /** Provider transport state; domain lifecycle remains owned by the controller/server. */
  onTransportState(state: CallTransportState): void;
}

export interface CallSession {
  leave(): Promise<void>;
  setMicrophone(enabled: boolean): Promise<void>;
  setCamera(enabled: boolean): Promise<void>;
  setScreenShare(enabled: boolean): Promise<void>;
}

export interface CallProvider {
  /**
   * Optional, idempotent warm-up for anything the transport will need but that
   * does not depend on the call existing yet — a heavy SDK chunk, for instance.
   * Called before the call is created so the download overlaps the callables
   * instead of queueing behind them.
   *
   * It must return immediately and must never throw: nothing has been created
   * when it runs, so there is no rollback path for it to fail into.
   */
  prepare?(): void;
  join(options: CallJoinOptions, signal: AbortSignal): Promise<CallSession>;
}
