import { callFunction } from '../../firebase/callables';
import type { CallJoinOptions, CallProvider, CallSession } from './call-provider';

interface LiveKitGrant {
  url: string;
  token: string;
}

export class LiveKitCallProvider implements CallProvider {
  async join(options: CallJoinOptions, signal: AbortSignal): Promise<CallSession> {
    const grant = await callFunction<Pick<CallJoinOptions, 'roomId' | 'callId'>, LiveKitGrant>(
      'getLiveKitToken',
      { roomId: options.roomId, callId: options.callId },
      { limitedUseAppCheckTokens: true },
    );
    const { Room, RoomEvent, Track } = await import('livekit-client');
    const room = new Room({ adaptiveStream: true, dynacast: true });
    const stage = options.stage;
    const disconnect = (): void => { void room.disconnect(); };
    signal.addEventListener('abort', disconnect, { once: true });

    const reportParticipants = (): void => {
      options.onParticipants([...room.remoteParticipants.values()].map((participant) => ({
        identity: participant.identity,
        name: participant.name || participant.identity,
      })));
    };

    await room.connect(grant.url, grant.token);
    room.on(RoomEvent.TrackSubscribed, (track) => {
      if (track.kind === Track.Kind.Audio) {
        const element = track.attach();
        element.dataset.chatLiteCallAudio = 'true';
        element.hidden = true;
        document.body.append(element);
      } else if (track.kind === Track.Kind.Video) {
        const element = track.attach();
        element.className = 'call-video';
        element.autoplay = true;
        (element as HTMLVideoElement).playsInline = true;
        stage.append(element);
      }
    });
    room.on(RoomEvent.TrackUnsubscribed, (track) => track.detach().forEach((element) => element.remove()));
    room.on(RoomEvent.ParticipantConnected, reportParticipants);
    room.on(RoomEvent.ParticipantDisconnected, reportParticipants);
    await room.localParticipant.setMicrophoneEnabled(options.audio);
    await room.localParticipant.setCameraEnabled(options.video);
    for (const publication of room.localParticipant.videoTrackPublications.values()) {
      const element = publication.track?.attach();
      if (!element) continue;
      element.className = 'call-video local';
      element.muted = true;
      element.autoplay = true;
      (element as HTMLVideoElement).playsInline = true;
      stage.append(element);
    }
    // Anyone already in the room raises no ParticipantConnected for this client,
    // so report once the connection settles rather than waiting for a change.
    reportParticipants();
    room.once(RoomEvent.Disconnected, () => signal.removeEventListener('abort', disconnect));
    return {
      async leave() {
        await room.disconnect();
        document.querySelectorAll('[data-chat-lite-call-audio]').forEach((element) => element.remove());
      },
      async setMicrophone(enabled) { await room.localParticipant.setMicrophoneEnabled(enabled); },
      async setCamera(enabled) { await room.localParticipant.setCameraEnabled(enabled); },
      async setScreenShare(enabled) { await room.localParticipant.setScreenShareEnabled(enabled); },
    };
  }
}
