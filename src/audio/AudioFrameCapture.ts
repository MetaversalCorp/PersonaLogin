import type { ProximityAudioManager } from './ProximityAudioManager.js';
import { AudioFrameBuffer } from './AudioFrameBuffer.js';

/** Options for constructing an AudioFrameCapture instance. */
export interface AudioFrameCaptureOptions {
  /**
   * Ring buffer capacity in total samples (all channels combined).
   * Default: `sampleRate × channelCount × 4` (~4 seconds of stereo audio).
   */
  bufferCapacity?: number;

  /**
   * Expected sample rate of the MVRP audio stream in Hz.
   * Default: 48000.
   */
  sampleRate?: number;

  /**
   * Number of channels expected from MVRP.
   * Default: 2 (stereo).
   */
  channelCount?: number;
}

/** Default capture buffer duration in seconds. */
const DEFAULT_BUFFER_DURATION_SECONDS = 4;

/**
 * AudioFrameCapture – taps the live audio stream at {@link AudioContext.destination}
 * and buffers the decoded PCM samples in an {@link AudioFrameBuffer} ring
 * buffer for consumption by speech-to-text or other audio processing pipelines.
 *
 * Instead of polling MVRP's internal `m_Buffer` (which is not populated during
 * normal Web Audio API playback), an {@link AnalyserNode} is connected directly
 * to `AudioContext.destination` where MVRP outputs decoded audio.  Each
 * `requestAnimationFrame` tick reads the most-recently-decoded samples via
 * `getFloatTimeDomainData()` and appends only the samples that have elapsed
 * since the previous poll to avoid duplication.
 *
 * Capture does **not** affect the existing MVRP → AudioContext.destination
 * playback chain; the AnalyserNode is a parallel, read-only tap.
 *
 * Lifecycle
 * ─────────
 *   const capture = new AudioFrameCapture(proximityAudioManager);
 *   capture.enable();                    // start collecting frames
 *   …
 *   const out = new Float32Array(1920);
 *   const n = capture.buffer.read(out);  // consume buffered PCM
 *   …
 *   capture.disable();                   // stop collecting (playback unaffected)
 *   capture.dispose();                   // release rAF loop
 */
export class AudioFrameCapture {
  private readonly audioManager: ProximityAudioManager;
  private readonly frameBuffer: AudioFrameBuffer;

  private _enabled: boolean = false;
  private pollHandle: ReturnType<typeof requestAnimationFrame> | null = null;

  /** AnalyserNode connected as a second listener to AudioContext.destination to passively monitor MVRP output. */
  private analyserNode: AnalyserNode | null = null;
  /** Scratch buffer for `getFloatTimeDomainData` – sized to `analyserNode.fftSize`. */
  private analyserBuffer: Float32Array | null = null;
  /** AudioContext.currentTime at the last successful capture, or -1 if not yet started. */
  private lastCaptureTime: number = -1;

  /**
   * @param audioManager  The active ProximityAudioManager whose
   *                      {@link AudioContext} destination will be tapped via an
   *                      AnalyserNode for decoded audio frames.
   * @param options       Optional buffer / stream configuration.
   */
  constructor(audioManager: ProximityAudioManager, options?: AudioFrameCaptureOptions) {
    const sampleRate   = options?.sampleRate   ?? 48000;
    const channelCount = options?.channelCount ?? 2;
    const bufferCapacity = options?.bufferCapacity ?? (sampleRate * channelCount * DEFAULT_BUFFER_DURATION_SECONDS);

    this.audioManager = audioManager;
    this.frameBuffer  = new AudioFrameBuffer(bufferCapacity, sampleRate, channelCount);
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  /**
   * Start capturing decoded audio frames.
   * Idempotent: calling while already enabled has no effect.
   *
   * Connects an AnalyserNode as a second listener to AudioContext.destination
   * to passively monitor the spatial audio output from MVRP (which is mixed
   * based on avatar positions). The AnalyserNode does not interfere with
   * playback—it simply reads the audio flowing to the speakers.
   */
  enable(): void {
    if (this._enabled) return;

    const ctx: AudioContext | null = this.audioManager.getAudioContext();

    if (ctx) {
      this.analyserNode = ctx.createAnalyser();
      // fftSize must be a power of two; 2048 gives ~42 ms of history at 48 kHz,
      // comfortably covering one rAF interval (~16 ms at 60 fps).
      this.analyserNode.fftSize = 2048;
      this.analyserBuffer = new Float32Array(this.analyserNode.fftSize);

      // Connect as second listener to destination (passive monitoring)
      this.analyserNode.connect(ctx.destination);
    }

    this._enabled = true;
    this.lastCaptureTime = -1;
    this.schedulePoll();
    console.log('[AudioFrameCapture] Capture enabled');
  }

  /**
   * Stop capturing audio frames.  Any samples already in the ring buffer are
   * preserved and can still be read.  Playback is unaffected.
   * Idempotent: calling while already disabled has no effect.
   */
  disable(): void {
    if (!this._enabled) return;
    this._enabled = false;

    if (this.pollHandle !== null) {
      cancelAnimationFrame(this.pollHandle);
      this.pollHandle = null;
    }

    if (this.analyserNode) {
      // Disconnect from destination
      this.analyserNode.disconnect();
      this.analyserNode = null;
      this.analyserBuffer = null;
    }

    console.log('[AudioFrameCapture] Capture disabled');
  }

  /**
   * Disable capture and release all resources.
   * The instance must not be used after calling `dispose()`.
   */
  dispose(): void {
    this.disable();
  }

  // ─── Accessors ────────────────────────────────────────────────────────────

  /**
   * The underlying ring buffer.  Read from it to consume captured PCM samples.
   *
   * The buffer stores interleaved samples in the order they were decoded by
   * MVRP (typically L, R, L, R … for stereo streams).
   */
  get buffer(): AudioFrameBuffer {
    return this.frameBuffer;
  }

  /** Sample rate of the captured audio (Hz). */
  get sampleRate(): number {
    return this.frameBuffer.sampleRate;
  }

  /** Number of interleaved channels stored in the ring buffer. */
  get channelCount(): number {
    return this.frameBuffer.channelCount;
  }

  /** `true` while the capture loop is running. */
  get isEnabled(): boolean {
    return this._enabled;
  }

  /**
   * Convenience helper: discard all samples currently in the ring buffer.
   * Useful before starting a new utterance for speech-to-text.
   */
  clearBuffer(): void {
    this.frameBuffer.clear();
  }

  // ─── Poll loop ────────────────────────────────────────────────────────────

  private schedulePoll(): void {
    const poll = () => {
      if (!this._enabled) return;
      this.pollHandle = requestAnimationFrame(poll);
      this.captureFrame();
    };
    this.pollHandle = requestAnimationFrame(poll);
  }

  /**
   * Read fresh time-domain samples from the AnalyserNode and append them to
   * the ring buffer.
   *
   * To avoid duplicating samples across consecutive rAF ticks, only the
   * portion of the AnalyserNode's window that is newer than the previous poll
   * (computed via `AudioContext.currentTime`) is written.  On the first tick
   * after enable() the baseline time is recorded and no samples are written,
   * ensuring the ring buffer always contains non-overlapping audio.
   */
  private captureFrame(): void {
    if (!this.analyserNode || !this.analyserBuffer) return;

    const ctx: AudioContext | null = this.audioManager.getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;

    // First tick: record baseline and skip writing so we always start with
    // a clean, non-overlapping window on the next tick.
    if (this.lastCaptureTime < 0) {
      this.lastCaptureTime = now;
      return;
    }

    const elapsed = now - this.lastCaptureTime;
    const newSamples = Math.floor(elapsed * this.frameBuffer.sampleRate);
    if (newSamples <= 0) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.analyserNode.getFloatTimeDomainData(this.analyserBuffer as any);

    // The AnalyserNode provides the most-recent `fftSize` samples.
    // Take only the freshest `newSamples` from the tail of that window.
    const bufLen = this.analyserBuffer.length;
    const startIdx = Math.max(0, bufLen - newSamples);
    this.frameBuffer.write(this.analyserBuffer, startIdx, bufLen - startIdx);

    this.lastCaptureTime = now;
  }
}
