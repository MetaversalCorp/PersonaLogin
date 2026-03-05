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
 * AudioFrameCapture – subscribes to decoded audio frames produced by MVRP and
 * buffers the raw PCM samples in an {@link AudioFrameBuffer} ring buffer for
 * consumption by speech-to-text or other audio processing pipelines.
 *
 * Capture is driven by `requestAnimationFrame` so it runs at display refresh
 * rate (≈60 fps), which is well above the MVRP decode cadence (~50 frames/s
 * at 48 kHz / 960 samples per slice).  Only frames whose `m_Buffer.nSlice`
 * counter has advanced since the last poll are copied, so samples are never
 * duplicated.
 *
 * Capture does **not** affect the existing MVRP → AudioContext.destination
 * playback chain; it is purely a read-side tap on MVRP's internal buffer.
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
  private lastSlice: number = -1;

  /**
   * @param audioManager  The active ProximityAudioManager whose MVRP instance
   *                      will be polled for decoded audio frames.
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
   */
  enable(): void {
    if (this._enabled) return;
    this._enabled = true;
    this.lastSlice = -1;
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
   * Check whether MVRP has decoded a new frame (indicated by an advancing
   * `m_Buffer.nSlice` counter) and, if so, copy the samples into the ring
   * buffer.
   */
  private captureFrame(): void {
    const proximity = this.audioManager.getProximity();
    if (!proximity) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mvrpAudio: any = proximity.GetAudio();
    if (!mvrpAudio) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const buf: any = mvrpAudio.m_Buffer;
    if (!buf) return;

    const currentSlice: number = buf.nSlice ?? 0;
    if (currentSlice === this.lastSlice) return; // no new decoded frame
    this.lastSlice = currentSlice;

    const asSample: number[] | null = buf.asSample;
    if (!asSample || asSample.length === 0) return;

    // Write the freshly decoded slice into the ring buffer.
    // asSample contains the samples for the current slice (nCount values).
    const nCount: number = buf.nCount ?? asSample.length;
    this.frameBuffer.write(asSample, 0, nCount);
  }
}
