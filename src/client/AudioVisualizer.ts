import type { ProximityAudioManager } from '../audio/ProximityAudioManager.js';

/** Options for configuring the AudioVisualizer. */
export interface VisualizerOptions {
  /** Background colour of the canvas. Default: 'rgba(0,0,0,0.45)'. */
  backgroundColor?: string;
  /** Bar colour for the left channel. Default: '#00eaff' (cyan). */
  colorLeft?: string;
  /** Bar colour for the right channel. Default: '#ff00cc' (magenta). */
  colorRight?: string;
}

/**
 * AudioVisualizer – renders a real-time dual-channel (L/R) looping time-series
 * waveform on an HTML5 canvas element placed inside the supplied container.
 *
 * The canvas is 280 × 240 px: the top 120 px show the left-channel waveform
 * (cyan) and the bottom 120 px show the right-channel waveform (magenta).
 * Each horizontal pixel corresponds to one amplitude sample stored in a
 * 280-sample circular buffer, producing a continuously scrolling display
 * similar to an oscilloscope or Audacity waveform view.
 *
 * Lifecycle
 * ─────────
 *   const vis = new AudioVisualizer(containerEl);
 *   vis.attachAudioSource(proximityAudioManager);   // begins animation loop
 *   …avatar is active…
 *   vis.dispose();                                  // stops loop, removes canvas
 *
 * Audio levels are read directly from MVRP's internal `m_Output.asLevel` array
 * each animation frame.  When no audio source is attached, `update()` can be
 * called directly with normalised L/R amplitude values for testing.
 */
export class AudioVisualizer {
  private readonly container: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx2d: CanvasRenderingContext2D;
  private readonly opts: Required<VisualizerOptions>;

  // MVRP audio manager reference (set in attachAudioSource)
  private audioManager: ProximityAudioManager | null = null;

  // Current L/R amplitude levels (0–1) read from MVRP or set via update()
  private levelL: number = 0;
  private levelR: number = 0;

  // requestAnimationFrame handle
  private animFrameId: number | null = null;

  // ─── Rolling sample buffers ──────────────────────────────────────────────────

  // Number of samples kept (one per canvas pixel width)
  private static readonly BUFFER_SIZE = 280;

  // Circular buffers for L/R channel amplitude samples (values in 0–1)
  private readonly sampleBufferL: Float32Array = new Float32Array(AudioVisualizer.BUFFER_SIZE);
  private readonly sampleBufferR: Float32Array = new Float32Array(AudioVisualizer.BUFFER_SIZE);

  // Write cursor; the oldest sample lives at this index
  private bufferIndex: number = 0;

  // ─── Constructor ────────────────────────────────────────────────────────────

  constructor(container: HTMLElement, options?: VisualizerOptions) {
    this.container = container;

    this.opts = {
      backgroundColor: options?.backgroundColor ?? 'rgba(0,0,0,0.45)',
      colorLeft: options?.colorLeft ?? '#00eaff',
      colorRight: options?.colorRight ?? '#ff00cc',
    };

    // Create and configure canvas
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'audio-visualizer-canvas';
    // Intrinsic resolution; CSS controls display size
    this.canvas.width = 280;
    this.canvas.height = 240;
    container.appendChild(this.canvas);

    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('[AudioVisualizer] Canvas 2D context unavailable');
    this.ctx2d = ctx;

    // Draw an idle state so the canvas is not blank before audio starts
    this.drawFrame();
  }

  // ─── Integration ────────────────────────────────────────────────────────────

  /**
   * Wire the visualizer into the live audio stream managed by `audioManager`.
   *
   * Reads audio levels directly from MVRP's `m_Output.asLevel` array each
   * animation frame, which contains the actual decoded audio amplitude data
   * at the output stage.  No Web Audio nodes are created or connected.
   * Starts the requestAnimationFrame draw loop automatically.
   *
   * Idempotent: subsequent calls have no effect while a source is already
   * attached.
   */
  attachAudioSource(audioManager: ProximityAudioManager): void {
    if (this.audioManager) return; // already attached

    const proximity = audioManager.getProximity();
    if (!proximity) {
      console.warn('[AudioVisualizer] Proximity not ready; call after ProximityAudioManager.start()');
      return;
    }

    this.audioManager = audioManager;
    this.startLoop();
    console.log('[AudioVisualizer] Attached to audio source; visualizer active');
  }

  /**
   * Push normalised L/R amplitude values directly into the visualizer.
   *
   * Useful for testing.  Values should be in the range 0–1.
   * Redraws immediately so callers can drive the refresh rate externally.
   */
  update(levelL: number, levelR: number): void {
    this.levelL = Math.max(0, Math.min(1, levelL));
    this.levelR = Math.max(0, Math.min(1, levelR));
    this.pushSample(this.levelL, this.levelR);
    this.drawFrame();
  }

  /**
   * Update the visualizer with raw PCM samples from a decoded audio frame.
   *
   * Computes per-channel RMS from the interleaved samples and updates the
   * amplitude bars accordingly.  The animation loop is started automatically
   * if it is not already running.
   *
   * This method provides a direct PCM path that runs in parallel with the
   * existing `attachAudioSource` / AnalyserNode path and is the preferred
   * route for feeding speech-to-text pipelines that already hold a decoded
   * PCM slice.
   *
   * @param samples       Interleaved PCM samples (numeric array-like).
   * @param channelCount  Channels interleaved in `samples`.  Default: 2.
   * @param normalize     When `true` the values are treated as signed int16
   *                      (range −32 768 … +32 767) and divided by 32 768 to
   *                      produce a 0–1 amplitude.  Set to `false` when samples
   *                      are already normalised.  Default: `true`.
   */
  updateFromPcm(samples: ArrayLike<number>, channelCount = 2, normalize = true): void {
    if (samples.length === 0) return;

    const scale = normalize ? 32768 : 1;
    let sumSqL = 0;
    let sumSqR = 0;
    const frames = Math.floor(samples.length / channelCount);

    if (channelCount >= 2) {
      for (let i = 0; i < frames; i++) {
        const l = (samples[i * 2] as number) / scale;
        const r = (samples[i * 2 + 1] as number) / scale;
        sumSqL += l * l;
        sumSqR += r * r;
      }
      this.levelL = Math.min(Math.sqrt(sumSqL / (frames || 1)), 1);
      this.levelR = Math.min(Math.sqrt(sumSqR / (frames || 1)), 1);
    } else {
      for (let i = 0; i < samples.length; i++) {
        const v = (samples[i] as number) / scale;
        sumSqL += v * v;
      }
      const rms = Math.min(Math.sqrt(sumSqL / (samples.length || 1)), 1);
      this.levelL = rms;
      this.levelR = rms;
    }

    // Ensure the animation loop is running even when no audio source has been
    // attached via attachAudioSource().
    this.pushSample(this.levelL, this.levelR);
    if (this.animFrameId === null) {
      this.startLoop();
    } else {
      this.drawFrame();
    }
  }

  /**
   * Stop the animation loop and remove the canvas from the DOM.
   * The instance must not be used after calling dispose().
   */
  dispose(): void {
    this.stopLoop();
    this.audioManager = null;

    if (this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas);
    }

    console.log('[AudioVisualizer] Disposed');
  }

  // ─── Animation loop ─────────────────────────────────────────────────────────

  private startLoop(): void {
    if (this.animFrameId !== null) return;
    const tick = () => {
      this.animFrameId = requestAnimationFrame(tick);
      // Read audio levels directly from MVRP's output stage
      const proximity = this.audioManager?.getProximity();
      if (proximity) {
        const mvrpAudio = proximity.GetAudio();
        const asLevel = mvrpAudio?.m_Output?.asLevel;
        if (asLevel) {
          // asLevel contains signed int16 amplitudes; 32768 is the max positive
          // value for a signed 16-bit integer, so dividing normalises to 0–1.
          this.levelL = this.normalizeLevel(asLevel[0] ?? 0);
          this.levelR = this.normalizeLevel(asLevel[1] ?? 0);
        }
      }
      this.pushSample(this.levelL, this.levelR);
      this.drawFrame();
    };
    this.animFrameId = requestAnimationFrame(tick);
  }

  private stopLoop(): void {
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }

  // ─── Rendering ──────────────────────────────────────────────────────────────

  /**
   * Normalise a signed int16 amplitude value to the range 0–1.
   *
   * @param value  Raw signed int16 amplitude from `m_Output.asLevel`.
   */
  private normalizeLevel(value: number): number {
    return Math.min(Math.abs(value) / 0.1, 1);
  }

  /**
   * Write the current L/R levels into the circular sample buffers and advance
   * the write cursor, overwriting the oldest sample when the buffer is full.
   */
  private pushSample(l: number, r: number): void {
    this.sampleBufferL[this.bufferIndex] = l;
    this.sampleBufferR[this.bufferIndex] = r;
    this.bufferIndex = (this.bufferIndex + 1) % AudioVisualizer.BUFFER_SIZE;
  }

  private drawFrame(): void {
    const { width, height } = this.canvas;
    const c = this.ctx2d;
    const halfH = height / 2;

    // Background
    c.fillStyle = this.opts.backgroundColor;
    c.fillRect(0, 0, width, height);

    // Left channel (top half) and right channel (bottom half)
    this.drawWaveform(this.sampleBufferL, 0, halfH, this.opts.colorLeft);
    this.drawWaveform(this.sampleBufferR, halfH, halfH, this.opts.colorRight);
  }

  /**
   * Render one channel's circular sample buffer as a looping time-series
   * waveform.  For each x-pixel the amplitude is drawn as a vertical line
   * centred in `areaH`, so silence produces a thin centre line and full
   * amplitude spans the entire half-canvas.
   *
   * @param buffer  Circular buffer of amplitude samples (0–1).
   * @param yTop    Top edge of the channel's drawing area (canvas-space).
   * @param areaH   Height of the channel's drawing area in pixels.
   * @param color   Stroke colour.
   */
  private drawWaveform(buffer: Float32Array, yTop: number, areaH: number, color: string): void {
    const c = this.ctx2d;
    const n = AudioVisualizer.BUFFER_SIZE;
    const centerY = yTop + areaH / 2;
    const halfAreaH = areaH / 2;

    c.strokeStyle = color;
    c.lineWidth = 1;

    // Build all line segments in a single path to minimise draw calls.
    c.beginPath();
    for (let x = 0; x < n; x++) {
      // bufferIndex is the oldest sample; walk forward from there so the
      // waveform scrolls left-to-right with the most recent sample on the right.
      const sampleIdx = (this.bufferIndex + x) % n;
      const amp = buffer[sampleIdx] ?? 0;
      const lineH = amp * halfAreaH;

      c.moveTo(x, centerY - lineH);
      c.lineTo(x, centerY + lineH);
    }
    c.stroke();
  }
}
