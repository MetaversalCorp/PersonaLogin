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
 * AudioVisualizer – renders real-time dual-channel (L/R) amplitude meters on
 * an HTML5 canvas element placed inside the supplied container.
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
    this.canvas.width  = 280;
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
        const l = (samples[i * 2]     as number) / scale;
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
    return Math.min(Math.abs(value) / 32768, 1);
  }

  private drawFrame(): void {
    const { width, height } = this.canvas;
    const c = this.ctx2d;

    // Background
    c.fillStyle = this.opts.backgroundColor;
    c.fillRect(0, 0, width, height);

    // Two equal-width bars with padding on the sides and a gap between
    const padX = Math.round(width * 0.1);
    const gap  = Math.round(width * 0.08);
    const barW = Math.round((width - padX * 2 - gap) / 2);
    const padY = Math.round(height * 0.05);
    const barAreaH = height - padY * 2;

    this.drawAmplitudeBar(this.levelL, padX,              padY, barW, barAreaH, this.opts.colorLeft);
    this.drawAmplitudeBar(this.levelR, padX + barW + gap, padY, barW, barAreaH, this.opts.colorRight);
  }

  /**
   * Render a single vertical amplitude bar.
   *
   * @param amplitude  Normalised amplitude in the range 0–1.
   * @param x          Left edge of the bar (canvas-space).
   * @param y          Top edge of the bar area (canvas-space).
   * @param barW       Width of the bar in pixels.
   * @param barAreaH   Total height of the bar area in pixels.
   * @param color      Fill colour for the bar.
   */
  private drawAmplitudeBar(
    amplitude: number,
    x: number,
    y: number,
    barW: number,
    barAreaH: number,
    color: string,
  ): void {
    const c = this.ctx2d;

    // Dim background track
    c.fillStyle = 'rgba(255,255,255,0.05)';
    c.fillRect(x, y, barW, barAreaH);

    const fillH = Math.round(Math.min(amplitude, 1) * barAreaH);
    if (fillH > 0) {
      // Gradient from base colour at the bottom to near-white at the top
      const grad = c.createLinearGradient(0, y + barAreaH, 0, y);
      grad.addColorStop(0, color);
      grad.addColorStop(1, 'rgba(255,255,255,0.85)');
      c.fillStyle = grad;
      c.fillRect(x, y + barAreaH - fillH, barW, fillH);
    }
  }
}
