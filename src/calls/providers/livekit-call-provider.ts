import type { LocalTrack, LocalTrackPublication, RemoteTrack } from 'livekit-client';

import { callFunction } from '../../firebase/callables';
import { RTC_CALLABLE_OPTIONS } from '../rtc-callable-options';
import type { CallJoinOptions, CallProvider, CallSession, CallTransportCredential } from './call-provider';

/**
 * Only the bindings this file actually uses. Holding the whole module namespace
 * instead costs ~5 kB gzip in the `rtc-livekit` chunk: the namespace counts as
 * live, so nothing in it can be shaken out. Narrowing here keeps the download
 * the warm-up was added to speed up from getting bigger.
 */
type LiveKitCore = Pick<
  typeof import('livekit-client'),
  'Room' | 'RoomEvent' | 'Track' | 'createLocalTracks'
>;

/**
 * `livekit-client` is by far the largest chunk this app ships and it must stay
 * out of the core bundle, so it is imported here and nowhere else. Caching the
 * promise means a second call in the same session does not pay for it twice; a
 * failed load is dropped so the next attempt can retry rather than replaying the
 * rejection forever.
 */
let sdk: Promise<LiveKitCore> | null = null;

function loadSdk(): Promise<LiveKitCore> {
  sdk ??= import('livekit-client')
    .then(({ Room, RoomEvent, Track, createLocalTracks }) => ({ Room, RoomEvent, Track, createLocalTracks }))
    .catch((error: unknown) => {
      sdk = null;
      throw error;
    });
  return sdk;
}

async function requestGrant(options: CallJoinOptions): Promise<CallTransportCredential> {
  // The transition that authorised this join may already have returned the
  // grant. Asking again would cost a second round trip - and a second App Check
  // attestation - for a credential we are already holding.
  if (options.credential) return options.credential;
  return callFunction<Pick<CallJoinOptions, 'roomId' | 'callId'>, CallTransportCredential>(
    'getLiveKitTokenV2',
    { roomId: options.roomId, callId: options.callId },
    RTC_CALLABLE_OPTIONS,
  );
}

export class LiveKitCallProvider implements CallProvider {
  prepare(): void {
    // Nothing awaits this: it exists purely so the download is already in flight
    // by the time the token comes back. The rejection is handled where the
    // module is actually needed.
    void loadSdk().catch(() => undefined);
  }

  async join(options: CallJoinOptions, signal: AbortSignal): Promise<CallSession> {
    options.onTransportState('connecting');
    // Started before the token request, not after it. The SDK does not depend on
    // the grant, so serialising them added the whole download to the critical
    // path for no reason.
    const sdkReady = loadSdk();
    const grant = await requestGrant(options);
    options.timeline?.mark('tokenReceived');
    signal.throwIfAborted();
    const { Room, RoomEvent, Track, createLocalTracks } = await sdkReady;
    options.timeline?.mark('sdkReady');
    const room = new Room({ adaptiveStream: true, dynacast: true });
    const attached = new Set<HTMLElement>();
    const attachedTracks = new Set<LocalTrack | RemoteTrack>();
    let leaving: Promise<void> | null = null;
    let intentionalLeave = false;
    let capturing: Promise<LocalTrack[]> | null = null;

    const attachRemote = (track: RemoteTrack): void => {
      if (attachedTracks.has(track)) return;
      attachedTracks.add(track);
      const element = track.attach();
      attached.add(element);
      if (track.kind === Track.Kind.Audio) {
        element.dataset.chatLiteCallAudio = options.callId;
        element.hidden = true;
        document.body.append(element);
        return;
      }
      element.className = 'call-video';
      element.autoplay = true;
      (element as HTMLVideoElement).playsInline = true;
      options.stage.append(element);
    };
    const attachLocal = (publication: LocalTrackPublication): void => {
      if (publication.kind !== Track.Kind.Video) return;
      const track = publication.track;
      if (!track || attachedTracks.has(track)) return;
      attachedTracks.add(track);
      const element = track.attach();
      if (!element) return;
      attached.add(element);
      element.className = 'call-video local';
      element.muted = true;
      element.autoplay = true;
      (element as HTMLVideoElement).playsInline = true;
      options.stage.append(element);
    };
    const detachTrack = (track: RemoteTrack): void => {
      attachedTracks.delete(track);
      for (const element of track.detach()) {
        attached.delete(element);
        element.remove();
      }
    };
    const detachLocal = (publication: LocalTrackPublication): void => {
      const track = publication.track;
      if (!track) return;
      attachedTracks.delete(track);
      for (const element of track.detach()) {
        attached.delete(element);
        element.remove();
      }
    };
    const reportParticipants = (): void => {
      options.onParticipants([...room.remoteParticipants.values()].map((participant) => ({
        identity: participant.identity,
        name: participant.name || participant.identity,
      })));
    };
    const onReconnecting = (): void => options.onTransportState('reconnecting');
    const onReconnected = (): void => {
      options.onTransportState('connected');
      reportParticipants();
    };
    const removeElements = (): void => {
      for (const element of attached) element.remove();
      attached.clear();
      attachedTracks.clear();
    };
    const removeListeners = (): void => {
      room.off(RoomEvent.TrackSubscribed, attachRemote);
      room.off(RoomEvent.TrackUnsubscribed, detachTrack);
      room.off(RoomEvent.LocalTrackPublished, attachLocal);
      room.off(RoomEvent.LocalTrackUnpublished, detachLocal);
      room.off(RoomEvent.ParticipantConnected, reportParticipants);
      room.off(RoomEvent.ParticipantDisconnected, reportParticipants);
      room.off(RoomEvent.Reconnecting, onReconnecting);
      room.off(RoomEvent.Reconnected, onReconnected);
      room.off(RoomEvent.Disconnected, onDisconnected);
      signal.removeEventListener('abort', onAbort);
    };
    const onDisconnected = (): void => {
      removeElements();
      removeListeners();
      if (!intentionalLeave) options.onTransportState('disconnected');
    };
    /**
     * Capture must not outlive the attempt that asked for it. `room.disconnect()`
     * stops whatever was published, but tracks acquired in parallel may not be
     * published - or even acquired - yet, and a permission prompt can stay open
     * for as long as the user ignores it. So this is never awaited: cancelling
     * has to be immediate, and whenever the prompt does settle the tracks are
     * stopped rather than left holding the microphone.
     */
    const releaseCapture = (): void => {
      const pending = capturing;
      if (!pending) return;
      capturing = null;
      void pending.then(
        (tracks) => { for (const track of tracks) track.stop(); },
        () => undefined,
      );
    };
    const leave = async (): Promise<void> => {
      if (leaving) return leaving;
      intentionalLeave = true;
      releaseCapture();
      leaving = (async () => {
        try {
          await room.disconnect();
        } finally {
          removeElements();
          removeListeners();
        }
      })();
      return leaving;
    };
    const onAbort = (): void => { void leave(); };

    room.on(RoomEvent.TrackSubscribed, attachRemote);
    room.on(RoomEvent.TrackUnsubscribed, detachTrack);
    room.on(RoomEvent.LocalTrackPublished, attachLocal);
    room.on(RoomEvent.LocalTrackUnpublished, detachLocal);
    room.on(RoomEvent.ParticipantConnected, reportParticipants);
    room.on(RoomEvent.ParticipantDisconnected, reportParticipants);
    room.on(RoomEvent.Reconnecting, onReconnecting);
    room.on(RoomEvent.Reconnected, onReconnected);
    room.on(RoomEvent.Disconnected, onDisconnected);
    signal.addEventListener('abort', onAbort, { once: true });

    try {
      // Local capture does not depend on the transport, and negotiation does not
      // depend on the tracks, so they run together. Only the devices the call
      // actually needs are opened: a voice call never touches the camera. This
      // is still strictly after the user asked for a call - nothing is acquired
      // speculatively on login or room entry.
      capturing = createLocalTracks({ audio: options.audio, video: options.video });
      // Claimed now so a connect failure cannot surface this as an unhandled
      // rejection before the catch below gets to stop the tracks.
      capturing.catch(() => undefined);
      await room.connect(grant.url, grant.token);
      options.timeline?.mark('providerConnected');
      signal.throwIfAborted();
      const tracks = await capturing;
      signal.throwIfAborted();
      await Promise.all(tracks.map((track) => room.localParticipant.publishTrack(track)));
      // Marked after publication, not after acquisition, so the stage keeps
      // meaning "local media is live in the call". What the overlap removes is
      // then visible as this stage shrinking rather than as a stage moving.
      options.timeline?.mark('mediaReady');
      for (const publication of room.localParticipant.videoTrackPublications.values()) attachLocal(publication);
      reportParticipants();
      options.onTransportState('connected');
    } catch (error) {
      await leave().catch(() => undefined);
      throw error;
    }

    return {
      leave,
      async setMicrophone(enabled) { await room.localParticipant.setMicrophoneEnabled(enabled); },
      async setCamera(enabled) { await room.localParticipant.setCameraEnabled(enabled); },
      async setScreenShare(enabled) { await room.localParticipant.setScreenShareEnabled(enabled); },
    };
  }
}
