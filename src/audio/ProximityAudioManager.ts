// MV is a global namespace populated by side-effect imports in LnG.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const MV: any;

import { AVStreamAudioPlayer } from './AVStreamAudioPlayer.js';

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
 *          → tapNode (GainNode)               [analysis tap point]
 *          → AudioContext.destination          [basic speaker playback]
 *
 *   Additionally, an AVStreamAudioPlayer is created over the same AudioContext,
 *   providing a GainNode → PannerNode → destination chain for spatial audio.
 *   Callers that need per-source volume or 3-D positioning can obtain the player
 *   via getAudioPlayer() and route decoded buffers through it.
 *
 * Analysis tap
 * ────────────
 *   connectAudioTap(node)    – splice an AnalyserNode/ChannelSplitterNode into
 *                              the MVRP output path for real-time monitoring
 *   disconnectAudioTap(node) – remove the tap when monitoring is no longer needed
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
  private tapNode: GainNode | null = null;
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
      // Create the MV proximity listener. Its internal MV.MVRP.Audio instance
      // handles all decoding (both codec 0 PCM16 and codec 1 delta-compression)
      // and routes decoded samples to AudioContext.destination automatically.
      this.proximity = new MV.MVRP.Proximity(pClient);

      const mvAudio = this.proximity.GetAudio();

      // Start(false) → creates AudioContext without requesting microphone access.
      // Pass true instead if microphone capture is also required.
      mvAudio.Start(false);

      // Build the spatial audio layer on top of the same AudioContext so that
      // all nodes share the same sample clock.
      const ctx: AudioContext = mvAudio.m_pContext;
      if (ctx) {
        this.audioContext = ctx;
        this.audioPlayer = new AVStreamAudioPlayer(ctx);

        // Insert a tap GainNode between MVRP's output and the speakers so
        // that analysis nodes (e.g. AudioVisualizer) can monitor the stream.
        this.tapNode = ctx.createGain();
        this.tapNode.connect(ctx.destination);

        console.log('[ProximityAudioManager] AVStreamAudioPlayer ready (sampleRate:', ctx.sampleRate, 'Hz)');
      }

      this._started = true;
      console.log('[ProximityAudioManager] Proximity audio started');
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

    if (this.tapNode) {
      try { this.tapNode.disconnect(); } catch { /* ignore */ }
      this.tapNode = null;
    }

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
   * Connect an audio node to the MVRP output tap for real-time monitoring.
   *
   * The tap is a GainNode that sits between MVRP's decoded audio output and
   * `AudioContext.destination`.  Connecting an AnalyserNode or
   * ChannelSplitterNode here allows the signal to be inspected without
   * affecting playback.
   *
   * Has no effect if audio has not been started yet.
   *
   * @param destination  The Web Audio node to receive the tapped signal.
   */
  connectAudioTap(destination: AudioNode): void {
    this.tapNode?.connect(destination);
  }

  /**
   * Remove a previously connected tap node.
   *
   * @param destination  The node originally passed to `connectAudioTap()`.
   */
  disconnectAudioTap(destination: AudioNode): void {
    try {
      this.tapNode?.disconnect(destination);
    } catch { /* ignore: node may already be disconnected */ }
  }

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

  /** Returns `true` if the audio engine is currently active. */
  get isStarted(): boolean {
    return this._started;
  }
}
