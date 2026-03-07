// MV is a global namespace populated by side-effect imports in LnG.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const MV: any;

import { AVStreamAudioPlayer } from './AVStreamAudioPlayer.js';
import type { AudioFrameCapture } from './AudioFrameCapture.js';

/**
 * ProximityAudioManager – owns the MV.MVRP.Proximity instance and wires it to
 * the Web Audio API for local speaker playback.
 *
 * Lifecycle
 * ─────────
 *   const mgr = new ProximityAudioManager(pLnG);
 *   mgr.start();          // creates Proximity + AudioContext; call once in-world
 *   …avatar is active…
 *   mgr.stop();           // tears down Proximity + AudioContext on exit
 *
 * Audio pipeline
 * ──────────────
 *   Server → MV.MVRP.Proximity.onRecv_Request()
 *          → MV.MVRP.Audio.Output()           [decode codec 0 / codec 1]
 *          → AudioContext.destination          [basic speaker playback]
 *
 *   Additionally, an AVStreamAudioPlayer is created over the same AudioContext,
 *   providing a GainNode → PannerNode → destination chain for spatial audio.
 *   Callers that need per-source volume or 3-D positioning can obtain the player
 *   via getAudioPlayer() and route decoded buffers through it.
 *
 * PCM buffer access
 * ─────────────────
 *   getAudioBuffer()   – returns the live MVRP `m_Buffer` for direct PCM access
 *   getAudioMetadata() – returns sampleRate, samplesPerSlice, bytesPerSample
 *   These are available for advanced callers that need direct access to the
 *   MVRP internal buffer.  AudioFrameCapture instead taps the live Web Audio
 *   signal via an AnalyserNode connected to the AVStreamAudioPlayer's GainNode.
 *
 * Mute / deaf controls
 * ─────────────────────
 *   muteLocalMic(true)  – suppress microphone transmission to server
 *   deafOutput(true)    – suppress speaker output locally
 */
export class ProximityAudioManager {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private pLnG: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private proximity: any = null;
  private audioPlayer: AVStreamAudioPlayer | null = null;
  private audioContext: AudioContext | null = null;
  private _started: boolean = false;

  /**
   * @param pLnG  The active pLnG service client from the MSF fabric
   *              (i.e. `getPFabric().pLnG`).  Its `.pClient` property is the
   *              underlying MVIO service connection that the Proximity instance
   *              registers with to receive audio packets from the server.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(pLnG: any) {
    this.pLnG = pLnG;
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  /**
   * Initialise the proximity listener and start the audio engine.
   *
   * Idempotent: calling start() more than once has no effect.
   *
   * The MV.MVRP.Proximity instance registers itself with the service connection
   * to receive proximity packets (avatar positions and audio streams).  Audio
   * playback begins automatically when the server sends encoded audio frames;
   * no additional configuration is required for basic speaker output.
   */
  start(): void {
    if (this._started) return;

    const pClient = this.pLnG?.pClient;
    if (!pClient) {
      console.warn('[ProximityAudioManager] pLnG.pClient not available; audio will not start');
      return;
    }

    try {
      this.proximity = new MV.MVRP.Proximity(pClient);
      const mvAudio = this.proximity.GetAudio();
      mvAudio.Start(false);

      // Hook into both codec decoders
      const decodedAudioFrames: Float32Array[] = [];

      const originalDecode0 = mvAudio.Decode[0];
      const originalDecode1 = mvAudio.Decode[1];

      mvAudio.Decode[0] = function (channelData: any, wSamples: number, byteStream: any) {
        const result = originalDecode0.call(this, channelData, wSamples, byteStream);
        console.log('[Decode0] Decoded', wSamples, 'samples into', channelData);

        // Read from m_Buffer after decode
        if (mvAudio.m_Buffer?.asSample) {
          const samples = Array.from(mvAudio.m_Buffer.asSample.slice(0, 20));
          console.log('m_Buffer samples after decode:', samples);
        }

        return result;
      };

      mvAudio.Decode[1] = function (channelData: any, wSamples: number, byteStream: any) {
        const result = originalDecode1.call(this, channelData, wSamples, byteStream);
        console.log('[Decode1] Decoded', wSamples, 'samples into', channelData);

        if (mvAudio.m_Buffer?.asSample) {
          const samples = Array.from(mvAudio.m_Buffer.asSample.slice(0, 20));
          console.log('m_Buffer samples after decode:', samples);
        }

        return result;
      };
    } catch (err) {
      console.error('[ProximityAudioManager] Failed to start audio:', err);
    }
  }

  /**
   * Stop the audio engine and release all resources.
   *
   * Idempotent: calling stop() when not started has no effect.
   */
  stop(): void {
    if (!this._started) return;
    this._started = false;

    if (this.audioPlayer) {
      this.audioPlayer.disconnect();
      this.audioPlayer = null;
    }

    this.audioContext = null;

    if (this.proximity) {
      try {
        const mvAudio = this.proximity.GetAudio();
        mvAudio?.Stop();
        this.proximity.destructor();
      } catch (err) {
        console.warn('[ProximityAudioManager] Error during audio teardown:', err);
      }
      this.proximity = null;
    }

    console.log('[ProximityAudioManager] Proximity audio stopped');
  }

  // ─── Audio controls ───────────────────────────────────────────────────────

  /**
   * Mute or unmute local microphone transmission to the server.
   * Has no effect if audio has not been started or if capture was not enabled.
   *
   * @param muted  `true` to mute microphone output; `false` to unmute.
   */
  muteLocalMic(muted: boolean): void {
    this.proximity?.GetAudio()?.Mute(muted);
  }

  /**
   * Enable or disable speaker output (deaf mode).
   * When deafened, incoming audio packets are decoded but not played back.
   *
   * @param deaf  `true` to silence speaker output; `false` to restore it.
   */
  deafOutput(deaf: boolean): void {
    this.proximity?.GetAudio()?.Deaf(deaf);
  }

  // ─── Accessors ────────────────────────────────────────────────────────────

  /**
   * Returns the AudioContext for this session, or `null` if audio has not
   * been started yet.
   */
  getAudioContext(): AudioContext | null {
    return this.audioContext;
  }

  /**
   * Returns the AVStreamAudioPlayer for this session, or `null` if audio has
   * not been started yet.
   *
   * Use the player to route additional decoded buffers through the
   * GainNode → PannerNode → destination spatial audio chain, or to adjust
   * per-stream volume and 3-D position.
   */
  getAudioPlayer(): AVStreamAudioPlayer | null {
    return this.audioPlayer;
  }

  /**
   * Returns the underlying MV.MVRP.Proximity instance, or `null` if audio has
   * not been started.  Exposed for advanced use (e.g. listening to proximity
   * events such as `onAvatarUpdate` or `onControl`).
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getProximity(): any {
    return this.proximity;
  }

  /**
   * Connect an AudioFrameCapture instance to the audio stream.
   * Designed to be called after the player is available (i.e. after start()).
   * @param capture The AudioFrameCapture instance to wire in.
   */
  connectAudioCapture(capture: AudioFrameCapture): void {
    if (!this.audioPlayer) return;
    const node = capture.processorNode;
    if (node) {
      this.audioPlayer.connectTap(node);
    }
  }

  /**
   * Disconnect a previously wired AudioFrameCapture.
   * @param capture The AudioFrameCapture instance to disconnect.
   */
  disconnectAudioCapture(capture: AudioFrameCapture): void {
    if (!this.audioPlayer) return;
    const node = capture.processorNode;
    if (node) {
      this.audioPlayer.disconnectTap(node);
    }
  }

  /**
   * Returns the live `m_Buffer` object from MVRP's internal audio decoder, or
   * `null` if audio has not been started.
   *
   * The returned object is a **live reference** updated in-place by MVRP as
   * each audio frame is decoded.  Copy data out of it promptly; do not hold
   * long-lived references to individual sub-fields.
   *
   * Buffer structure:
   * ```
   *   pArrayBuffer  – raw binary data          (ArrayBuffer | null)
   *   asSample      – decoded samples (float)  (number[] | null)
   *   nSize         – buffer capacity           (number)
   *   nBytes        – bytes currently used      (number)
   *   nCount        – sample count for slice    (number)
   *   nLength       – current data length       (number)
   *   nHead         – read head position        (number)
   *   nTail         – write tail position       (number)
   *   nSlice        – slice index, increments per decoded frame (number)
   * ```
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getAudioBuffer(): any | null {
    if (!this.proximity) return null;
    return this.proximity.GetAudio()?.m_Buffer ?? null;
  }

  /**
   * Returns audio stream metadata from MVRP, or `null` if audio has not been
   * started.
   *
   * @returns Object with:
   *   - `sampleRate`      – sample rate in Hz (typically 48000)
   *   - `samplesPerSlice` – decoded samples per frame slice (~960)
   *   - `bytesPerSample`  – bytes per sample (2 for PCM16, 4 for float32)
   */
  getAudioMetadata(): { sampleRate: number; samplesPerSlice: number; bytesPerSample: number } | null {
    if (!this.proximity) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mvrpAudio: any = this.proximity.GetAudio();
    if (!mvrpAudio) return null;
    return {
      sampleRate: mvrpAudio.m_nSampleRate ?? 48000,
      samplesPerSlice: mvrpAudio.m_nSamples_Slice ?? 960,
      bytesPerSample: mvrpAudio.m_nBytes_Sample ?? 2,
    };
  }

  /** Returns `true` if the audio engine is currently active. */
  get isStarted(): boolean {
    return this._started;
  }
}
