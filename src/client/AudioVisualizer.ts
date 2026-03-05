import type { ProximityAudioManager } from '../audio/ProximityAudioManager.js';

/** Options for configuring the AudioVisualizer. */
export interface VisualizerOptions {
  /** FFT size (power of two) – determines the number of samples analysed. Default: 1024. */
  fftSize?: number;
  /** Background colour of the canvas. Default: 'rgba(0,0,0,0.45)'. */
  backgroundColor?: string;
  /** Waveform colour for the left channel. Default: '#00eaff' (cyan). */
  colorLeft?: string;
  /** Waveform colour for the right channel. Default: '#ff00cc' (magenta). */
  colorRight?: string;
}

/**
 * AudioVisualizer – renders real-time dual-channel (L/R) amplitude meters on
 * an HTML5 canvas element placed inside the supplied container.
 *
 * Lifecycle
 * ─────────
 *   const vis = new AudioVisualizer(containerEl, { fftSize: 1024 });
 *   vis.attachAudioSource(proximityAudioManager);   // begins animation loop
 *   …avatar is active…
 *   vis.dispose();                                  // stops loop, removes canvas
 *
 * When no audio source is attached `update()` can be called directly with
 * pre-decoded Float32Array channel data for testing or alternative integrations.
 */
export class AudioVisualizer {
  private readonly container: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx2d: CanvasRenderingContext2D;
  private readonly opts: Required<VisualizerOptions>;

  // Web Audio analysis nodes (created in attachAudioSource)
  private audioContext: AudioContext | null = null;
  private analyserL: AnalyserNode | null = null;
  private analyserR: AnalyserNode | null = null;
  private splitter: ChannelSplitterNode | null = null;

  // Sample buffers written by the analyser nodes (or by update())
  private bufferL: Float32Array<ArrayBuffer>;
  private bufferR: Float32Array<ArrayBuffer>;

  // requestAnimationFrame handle
  private animFrameId: number | null = null;

  // ─── Constructor ────────────────────────────────────────────────────────────

  constructor(container: HTMLElement, options?: VisualizerOptions) {
    this.container = container;

    this.opts = {
      fftSize: options?.fftSize ?? 1024,
      backgroundColor: options?.backgroundColor ?? 'rgba(0,0,0,0.45)',
      colorLeft: options?.colorLeft ?? '#00eaff',
      colorRight: options?.colorRight ?? '#ff00cc',
    };

    // Pre-allocate sample buffers (half of fftSize = time-domain buffer length)
    const bufLen = this.opts.fftSize / 2;
    this.bufferL = new Float32Array(bufLen) as Float32Array<ArrayBuffer>;
    this.bufferR = new Float32Array(bufLen) as Float32Array<ArrayBuffer>;

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

    // Draw an idle waveform so the canvas is not blank before audio starts
    this.drawFrame();
  }

  // ─── Integration ────────────────────────────────────────────────────────────

  /**
   * Wire the visualizer into the live audio stream managed by `audioManager`.
   *
   * Taps the GainNode output of the underlying AVStreamAudioPlayer through a
   * ChannelSplitterNode so that L and R channels are analysed independently.
   * Starts the requestAnimationFrame draw loop automatically.
   *
   * Idempotent: subsequent calls have no effect while a source is already
   * attached.
   */
  attachAudioSource(audioManager: ProximityAudioManager): void {
    if (this.audioContext) return; // already attached

    const player = audioManager.getAudioPlayer();
    if (!player) {
      console.warn('[AudioVisualizer] AVStreamAudioPlayer not ready; will retry via update()');
      return;
    }

    const ctx = player.context;
    this.audioContext = ctx;

    // Create per-channel analysers
    this.analyserL = ctx.createAnalyser();
    this.analyserR = ctx.createAnalyser();
    this.analyserL.fftSize = this.opts.fftSize;
    this.analyserR.fftSize = this.opts.fftSize;

    // Reallocate sample buffers to match the actual analyser buffer length
    this.bufferL = new Float32Array(this.analyserL.frequencyBinCount) as Float32Array<ArrayBuffer>;
    this.bufferR = new Float32Array(this.analyserR.frequencyBinCount) as Float32Array<ArrayBuffer>;

    // Split the stereo output of the gain node into individual channels
    this.splitter = ctx.createChannelSplitter(2);
    this.splitter.connect(this.analyserL, 0);
    this.splitter.connect(this.analyserR, 1);

    // Tap the gainNode (parallel connection – doesn't affect playback)
    player.connectTap(this.splitter);

    this.startLoop();
    console.log('[AudioVisualizer] Attached to audio source; visualizer active');
  }

  /**
   * Push decoded L/R channel data directly into the visualizer.
   *
   * Useful for testing or when the Web Audio AnalyserNode is not available.
   * Copies a slice of up to `bufferL.length` samples from each input array.
   */
  update(leftChannelData: Float32Array, rightChannelData: Float32Array): void {
    const len = Math.min(leftChannelData.length, this.bufferL.length);
    this.bufferL.set(leftChannelData.subarray(0, len));

    const lenR = Math.min(rightChannelData.length, this.bufferR.length);
    this.bufferR.set(rightChannelData.subarray(0, lenR));

    // Draw immediately so callers can drive the refresh rate externally
    this.drawFrame();
  }

  /**
   * Stop the animation loop, disconnect analysis nodes, and remove the canvas
   * from the DOM.  The instance must not be used after calling dispose().
   */
  dispose(): void {
    this.stopLoop();

    if (this.splitter) {
      try {
        this.splitter.disconnect();
      } catch { /* already disconnected */ }
      this.splitter = null;
    }

    if (this.analyserL) {
      try { this.analyserL.disconnect(); } catch { /* ignore */ }
      this.analyserL = null;
    }
    if (this.analyserR) {
      try { this.analyserR.disconnect(); } catch { /* ignore */ }
      this.analyserR = null;
    }

    this.audioContext = null;

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
      // Pull latest time-domain data from analyser nodes
      if (this.analyserL) this.analyserL.getFloatTimeDomainData(this.bufferL);
      if (this.analyserR) this.analyserR.getFloatTimeDomainData(this.bufferR);
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

  private drawFrame(): void {
    const { width, height } = this.canvas;
    const c = this.ctx2d;

    // Background
    c.fillStyle = this.opts.backgroundColor;
    c.fillRect(0, 0, width, height);

    // Compute RMS amplitude for each channel
    const ampL = this.calculateRMS(this.bufferL);
    const ampR = this.calculateRMS(this.bufferR);

    // Two equal-width bars with padding on the sides and a gap between
    const padX = Math.round(width * 0.1);
    const gap  = Math.round(width * 0.08);
    const barW = Math.round((width - padX * 2 - gap) / 2);
    const padY = Math.round(height * 0.05);
    const barAreaH = height - padY * 2;

    this.drawAmplitudeBar(ampL, padX,            padY, barW, barAreaH, this.opts.colorLeft);
    this.drawAmplitudeBar(ampR, padX + barW + gap, padY, barW, barAreaH, this.opts.colorRight);
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

  // ─── Amplitude helpers ───────────────────────────────────────────────────────

  /**
   * Calculate RMS (Root Mean Square) amplitude of a sample buffer.
   * Returns a value in the range 0–1.
   */
  private calculateRMS(data: Float32Array): number {
    if (data.length === 0) return 0;
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      sum += data[i] * data[i];
    }
    return Math.sqrt(sum / data.length);
  }

  /**
   * Calculate peak (maximum absolute) amplitude of a sample buffer.
   * Returns a value in the range 0–1.
   * Available as an alternative to RMS for peak-hold meters.
   */
  private calculatePeak(data: Float32Array): number {
    let peak = 0;
    for (let i = 0; i < data.length; i++) {
      const abs = Math.abs(data[i]);
      if (abs > peak) peak = abs;
    }
    return peak;
  }
}
