// src/mv/LnG.ts
var GUEST_EMAIL = "guest@rp1.com";
function getMsfConfigUrl() {
  return "https://cdn.rp1.com/res/apps/persona.msf.json";
}
var pFabric = null;
function getPFabric() {
  return pFabric;
}
function ensureLnGReady() {
  return new Promise((resolve, reject) => {
    const READY_TIMEOUT_MS = 3e4;
    const timer = setTimeout(() => {
      pFabric.Detach(listener);
      reject(new Error("[LnG] Timed out waiting for MSF to become ready"));
    }, READY_TIMEOUT_MS);
    const listener = {
      onReadyState: () => {
        if (pFabric.IsReady()) {
          clearTimeout(timer);
          pFabric.Detach(listener);
          resolve();
        }
      }
    };
    pFabric.Attach(listener);
  });
}
function createLnGClient() {
  pFabric = new MV.MVRP.MSF(getMsfConfigUrl(), MV.MVRP.MSF.eMETHOD.GET, null);
  return {
    async Login(encoded, finalizationHandler) {
      await ensureLnGReady();
      return new Promise((resolve, reject) => {
        const loginListener = {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onReadyState(pNotice) {
            const pLnG = pFabric.pLnG;
            if (!pLnG) {
              pFabric?.pLnG?.Detach(loginListener);
              return;
            }
            if (pNotice.pEmitter === pLnG) {
              const state = pLnG.ReadyState();
              if (state === pLnG.eSTATE.LOGGEDIN) {
                pLnG.Detach(loginListener);
                const rawUserIx = pLnG.pSession?.twUserIx;
                const twUserIx = typeof rawUserIx === "bigint" ? rawUserIx : BigInt(rawUserIx ?? 0);
                const user = {
                  id: String(twUserIx),
                  twUserIx,
                  displayName: "",
                  personas: []
                };
                resolve(user);
              } else if (state === pLnG.eSTATE.DISCONNECTED) {
                pLnG.Detach(loginListener);
                reject(new Error("[LnG] Authentication failed"));
              }
            } else if (finalizationHandler && pNotice.pEmitter === pLnG.pSession && pLnG.pSession?.ReadyState() === pLnG.pSession?.eSTATE.LOGGINGIN_AUTHENTICATE) {
              finalizationHandler((code) => {
                pLnG.Login(code);
              });
            }
          }
        };
        pFabric.pLnG.Attach(loginListener);
        pFabric.pLnG.Login(encoded);
      });
    },
    async Logout() {
      if (pFabric?.pLnG) {
        pFabric.pLnG.Logout();
      }
    }
  };
}

// src/types/PersonaInfo.ts
var PersonaInfo = class {
  constructor(personaId, displayName, avatarUrl, worldId, regionId, metadata = {}) {
    this.personaId = personaId;
    this.displayName = displayName;
    this.avatarUrl = avatarUrl;
    this.worldId = worldId;
    this.regionId = regionId;
    this.metadata = metadata;
  }
  toJSON() {
    return {
      personaId: this.personaId,
      displayName: this.displayName,
      avatarUrl: this.avatarUrl,
      worldId: this.worldId,
      regionId: this.regionId,
      metadata: this.metadata
    };
  }
};

// src/base/Session.ts
var Session = class {
  constructor() {
    this._state = "Disconnected" /* Disconnected */;
    this._observers = [];
  }
  get state() {
    return this._state;
  }
  setState(next) {
    if (next === this._state) return;
    const prev = this._state;
    this._state = next;
    for (const obs of this._observers) {
      obs(next, prev);
    }
  }
  onStateChange(observer) {
    this._observers.push(observer);
    return () => {
      const idx = this._observers.indexOf(observer);
      if (idx !== -1) this._observers.splice(idx, 1);
    };
  }
};

// src/avatar/Avatar.ts
var Avatar = class {
  constructor(personaInfo) {
    this._spawned = false;
    this.personaInfo = personaInfo;
  }
  get spawned() {
    return this._spawned;
  }
  get personaId() {
    return this.personaInfo.personaId;
  }
  get displayName() {
    return this.personaInfo.displayName;
  }
};

// src/utils/FlagQueue.ts
var FlagQueue = class {
  constructor() {
    this.queue = [];
    this.activeFlags = /* @__PURE__ */ new Set();
    this.listeners = /* @__PURE__ */ new Map();
  }
  enqueue(flag) {
    if (!this.activeFlags.has(flag)) {
      this.activeFlags.add(flag);
      this.queue.push(flag);
      this.notify(flag, true);
    }
  }
  dequeue(flag) {
    if (this.activeFlags.has(flag)) {
      this.activeFlags.delete(flag);
      this.queue = this.queue.filter((f) => f !== flag);
      this.notify(flag, false);
    }
  }
  isActive(flag) {
    return this.activeFlags.has(flag);
  }
  getQueue() {
    return this.queue;
  }
  on(flag, listener) {
    if (!this.listeners.has(flag)) {
      this.listeners.set(flag, []);
    }
    this.listeners.get(flag).push(listener);
    return () => this.off(flag, listener);
  }
  off(flag, listener) {
    const arr = this.listeners.get(flag);
    if (arr) {
      const idx = arr.indexOf(listener);
      if (idx !== -1) arr.splice(idx, 1);
    }
  }
  clear() {
    for (const flag of [...this.activeFlags]) {
      this.dequeue(flag);
    }
  }
  notify(flag, active) {
    const arr = this.listeners.get(flag);
    if (arr) {
      for (const listener of arr) {
        listener(active);
      }
    }
  }
};

// src/avatar/PersonaPuppet.ts
var PersonaPuppet = class extends Avatar {
  constructor(personaInfo, inWorldSession = null) {
    super(personaInfo);
    this.transform = { x: 0, y: 0, z: 0, rotY: 0 };
    this.flagQueue = new FlagQueue();
    this.inWorldSession = inWorldSession;
  }
  async spawn() {
    if (this._spawned) return;
    this._spawned = true;
    console.log(`[PersonaPuppet] Spawned persona ${this.personaId} as "${this.displayName}"`);
  }
  async despawn() {
    if (!this._spawned) return;
    this.flagQueue.clear();
    this._spawned = false;
    console.log(`[PersonaPuppet] Despawned persona ${this.personaId}`);
  }
  /**
   * Move the avatar to a new world position and transmit it to the service.
   * @param positionUniversal - POSITION_UNIVERSAL with pParent and pRelative coordinates.
   */
  moveTo(positionUniversal) {
    if (!this._spawned) return;
    this.transform = {
      x: positionUniversal.pRelative.vPosition.dX,
      y: positionUniversal.pRelative.vPosition.dY,
      z: positionUniversal.pRelative.vPosition.dZ,
      rotY: 0
    };
    console.log(`[PersonaPuppet] moveTo`, positionUniversal);
    this.sendUpdate(String(positionUniversal.pParent.twObjectIx));
  }
  /**
   * Encode current avatar position/rotation and send an UPDATE to the persona service.
   * Calls rPersona.Send('UPDATE', ...) with position and rotation state.
   */
  sendUpdate(celestialId = "104") {
    if (!this._spawned) return;
    const rPersona = this.getRPersona();
    if (!rPersona?.Send) return;
    const tmStamp = Date.now();
    const sinHalf = Math.sin(this.transform.rotY / 2);
    const cosHalf = Math.cos(this.transform.rotY / 2);
    const rotDwV = rPersona.Quat_Encode([0, sinHalf, 0, cosHalf]);
    if (typeof rotDwV !== "number" || isNaN(rotDwV)) {
      console.warn("[PersonaPuppet] Quat_Encode returned invalid value:", rotDwV, ", skipping sendUpdate");
      return;
    }
    rPersona.Send("UPDATE", {
      tmStamp,
      pState: {
        pPosition_Head: {
          pParent: { twObjectIx: celestialId, wClass: 0 },
          pRelative: {
            vPosition: {
              dX: this.transform.x,
              dY: this.transform.y,
              dZ: this.transform.z
            }
          }
        },
        pRotation_Head: { dwV: rotDwV },
        pRotation_Body: { dwV: rotDwV }
      }
    });
  }
  /**
   * Trigger an avatar animation by name.
   * Calls rPersona.Send() with animation flag.
   */
  playAnimation(animationName) {
    if (!this._spawned) return;
    this.flagQueue.enqueue(animationName);
    console.log(`[PersonaPuppet] playAnimation "${animationName}"`);
  }
  /**
   * Stop a playing animation.
   */
  stopAnimation(animationName) {
    if (!this._spawned) return;
    this.flagQueue.dequeue(animationName);
    console.log(`[PersonaPuppet] stopAnimation "${animationName}"`);
  }
  getTransform() {
    return { ...this.transform };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getRPersona() {
    return this.inWorldSession?.personaSession?.pRPersona;
  }
};

// src/audio/AVStreamAudioPlayer.ts
var AVStreamAudioPlayer = class {
  /**
   * @param audioContext  Shared AudioContext created by ProximityAudioManager.
   *                      All nodes are attached to this context so they share
   *                      the same sample clock as the MVRP audio pipeline.
   */
  constructor(audioContext) {
    this._connected = false;
    this.audioContext = audioContext;
    this.gainNode = audioContext.createGain();
    this.pannerNode = audioContext.createPanner();
    this.pannerNode.panningModel = "HRTF";
    this.pannerNode.distanceModel = "inverse";
    this.pannerNode.refDistance = 1;
    this.pannerNode.maxDistance = 1e4;
    this.pannerNode.rolloffFactor = 1;
    this.pannerNode.coneInnerAngle = 360;
    this.pannerNode.coneOuterAngle = 0;
    this.pannerNode.coneOuterGain = 0;
    this.gainNode.connect(this.pannerNode);
    this.pannerNode.connect(audioContext.destination);
    this._connected = true;
  }
  // ─── Playback ─────────────────────────────────────────────────────────────
  /**
   * Schedule an AudioBuffer for playback through the gain/panner chain.
   *
   * @param buffer    Decoded AudioBuffer (e.g. from MV.MVRP.Audio.Decode).
   * @param startTime Optional AudioContext time in seconds.  Defaults to
   *                  `audioContext.currentTime` (play immediately).
   */
  playBuffer(buffer, startTime) {
    if (!this._connected) return;
    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gainNode);
    source.start(startTime ?? this.audioContext.currentTime);
  }
  // ─── Spatial controls ─────────────────────────────────────────────────────
  /**
   * Set the 3-D position of this audio source in world space.
   * Uses the AudioContext coordinate system (right-hand, Y-up).
   */
  setPosition(x, y, z) {
    if (typeof this.pannerNode.positionX !== "undefined") {
      this.pannerNode.positionX.value = x;
      this.pannerNode.positionY.value = y;
      this.pannerNode.positionZ.value = z;
    } else {
      this.pannerNode.setPosition(x, y, z);
    }
  }
  // ─── Volume control ───────────────────────────────────────────────────────
  /**
   * Set the output gain (volume) for this stream.
   * @param volume  Linear gain value: 0.0 (silent) … 1.0 (unity) … >1.0 (boost).
   */
  setVolume(volume) {
    this.gainNode.gain.value = volume;
  }
  /** Returns the current linear gain value. */
  get volume() {
    return this.gainNode.gain.value;
  }
  // ─── Analysis tap ─────────────────────────────────────────────────────────
  /**
   * Connect an additional output node (e.g. an AnalyserNode or
   * ChannelSplitterNode) to the gain node for monitoring purposes.
   *
   * The tap runs in parallel with the existing gain → panner → destination
   * chain and does not affect playback.
   *
   * @param destination  The Web Audio node to receive the tapped signal.
   */
  connectTap(destination) {
    if (!this._connected) return;
    this.gainNode.connect(destination);
  }
  /**
   * Remove a previously connected tap node.
   *
   * @param destination  The node originally passed to `connectTap()`.
   */
  disconnectTap(destination) {
    try {
      this.gainNode.disconnect(destination);
    } catch {
    }
  }
  // ─── Lifecycle ────────────────────────────────────────────────────────────
  /**
   * Disconnect all nodes and release Web Audio API resources.
   * After calling `disconnect()` the player must not be used again.
   */
  disconnect() {
    if (!this._connected) return;
    this._connected = false;
    try {
      this.gainNode.disconnect();
      this.pannerNode.disconnect();
    } catch {
    }
  }
  /** Returns the underlying AudioContext. */
  get context() {
    return this.audioContext;
  }
};

// src/audio/ProximityAudioManager.ts
var ProximityAudioManager = class {
  /**
   * @param pLnG  The active pLnG service client from the MSF fabric
   *              (i.e. `getPFabric().pLnG`).  Its `.pClient` property is the
   *              underlying MVIO service connection that the Proximity instance
   *              registers with to receive audio packets from the server.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(pLnG) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.proximity = null;
    this.audioPlayer = null;
    this.audioContext = null;
    this._started = false;
    this.decodeFrameCapture = null;
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
  start() {
    if (this._started) return;
    const pClient = this.pLnG?.pClient;
    if (!pClient) {
      console.warn("[ProximityAudioManager] pLnG.pClient not available; audio will not start");
      return;
    }
    try {
      this.proximity = new MV.MVRP.Proximity(pClient);
      const mvAudio = this.proximity.GetAudio();
      mvAudio.Start(false);
      const ctx = mvAudio.m_pContext;
      if (ctx) {
        this.audioContext = ctx;
        this.audioPlayer = new AVStreamAudioPlayer(ctx);
        this.setupDecodeInterception(mvAudio);
        console.log("[ProximityAudioManager] AVStreamAudioPlayer ready (sampleRate:", ctx.sampleRate, "Hz)");
      }
      this._started = true;
      console.log("[ProximityAudioManager] Proximity audio started");
    } catch (err) {
      console.error("[ProximityAudioManager] Failed to start audio:", err);
    }
  }
  /**
   * Stop the audio engine and release all resources.
   *
   * Idempotent: calling stop() when not started has no effect.
   */
  stop() {
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
        console.warn("[ProximityAudioManager] Error during audio teardown:", err);
      }
      this.proximity = null;
    }
    console.log("[ProximityAudioManager] Proximity audio stopped");
  }
  // ─── Audio controls ───────────────────────────────────────────────────────
  /**
   * Mute or unmute local microphone transmission to the server.
   * Has no effect if audio has not been started or if capture was not enabled.
   *
   * @param muted  `true` to mute microphone output; `false` to unmute.
   */
  muteLocalMic(muted) {
    this.proximity?.GetAudio()?.Mute(muted);
  }
  /**
   * Enable or disable speaker output (deaf mode).
   * When deafened, incoming audio packets are decoded but not played back.
   *
   * @param deaf  `true` to silence speaker output; `false` to restore it.
   */
  deafOutput(deaf) {
    this.proximity?.GetAudio()?.Deaf(deaf);
  }
  // ─── Accessors ────────────────────────────────────────────────────────────
  /**
   * Returns the AudioContext for this session, or `null` if audio has not
   * been started yet.
   */
  getAudioContext() {
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
  getAudioPlayer() {
    return this.audioPlayer;
  }
  /**
   * Returns the underlying MV.MVRP.Proximity instance, or `null` if audio has
   * not been started.  Exposed for advanced use (e.g. listening to proximity
   * events such as `onAvatarUpdate` or `onControl`).
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getProximity() {
    return this.proximity;
  }
  /**
   * Connect an AudioFrameCapture instance to the audio stream.
   * Designed to be called after the player is available (i.e. after start()).
   * @param capture The AudioFrameCapture instance to wire in.
   */
  connectAudioCapture(capture) {
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
  disconnectAudioCapture(capture) {
    if (!this.audioPlayer) return;
    const node = capture.processorNode;
    if (node) {
      this.audioPlayer.disconnectTap(node);
    }
  }
  /**
   * Register an AudioFrameCapture instance to receive decoded samples directly
   * from the MVRP decode stage.  MVRP passes `channelData` as a pre-interleaved
   * Float32Array (L0, R0, L1, R1, …), which is written directly to the capture's
   * ring buffer on every decode call.
   *
   * Call this after {@link start} to wire a capture into the decode path.
   * Only one capture may be registered at a time; calling again replaces any
   * previously registered capture.
   *
   * @param capture The AudioFrameCapture instance to wire in.
   */
  registerDecodeCapture(capture) {
    this.decodeFrameCapture = capture;
    console.log("[ProximityAudioManager] AudioFrameCapture registered for decode interception");
  }
  /**
   * Unregister the current decode capture.
   * After this call, decoded samples are no longer forwarded to a capture
   * instance.  Playback is unaffected.
   */
  unregisterDecodeCapture() {
    this.decodeFrameCapture = null;
    console.log("[ProximityAudioManager] AudioFrameCapture unregistered");
  }
  /**
   * Hook into MVRP's decode functions to intercept decoded PCM samples.
   * Wraps mvAudio.Decode[0] (codec 0 / PCM16) and mvAudio.Decode[1]
   * (codec 1 / delta) so that channelData is forwarded to the registered
   * {@link decodeFrameCapture} on every decode call.  The original decode
   * function is always called first so playback is unaffected.
   *
   * Note: MVRP passes `channelData` as a pre-interleaved Float32Array with
   * the layout [L0, R0, L1, R1, …], not as separate per-channel arrays.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setupDecodeInterception(mvAudio) {
    const originalDecode0 = mvAudio.Decode[0];
    const originalDecode1 = mvAudio.Decode[1];
    const decodeInterceptor = (mvAudioCtx, channelData, wSamples, byteStream, originalFn, codecLabel) => {
      const result = originalFn.call(mvAudioCtx, channelData, wSamples, byteStream);
      if (this.decodeFrameCapture) {
        this.writeDecodedSamplesToCapture(channelData);
      }
      return result;
    };
    mvAudio.Decode[0] = function(channelData, wSamples, byteStream) {
      return decodeInterceptor(this, channelData, wSamples, byteStream, originalDecode0, "Decode0");
    };
    mvAudio.Decode[1] = function(channelData, wSamples, byteStream) {
      return decodeInterceptor(this, channelData, wSamples, byteStream, originalDecode1, "Decode1");
    };
  }
  /**
   * Write interleaved audio data directly to the frame capture buffer.
   * The channelData from MVRP's decode is already in interleaved format
   * (L0, R0, L1, R1, …), so no further interleaving is needed.
   *
   * @param channelData  Pre-interleaved Float32Array from the MVRP decoder.
   */
  writeDecodedSamplesToCapture(channelData) {
    if (!this.decodeFrameCapture) return;
    this.decodeFrameCapture.buffer.write(channelData);
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
  getAudioBuffer() {
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
  getAudioMetadata() {
    if (!this.proximity) return null;
    const mvrpAudio = this.proximity.GetAudio();
    if (!mvrpAudio) return null;
    return {
      sampleRate: mvrpAudio.m_nSampleRate ?? 48e3,
      samplesPerSlice: mvrpAudio.m_nSamples_Slice ?? 960,
      bytesPerSample: mvrpAudio.m_nBytes_Sample ?? 2
    };
  }
  /** Returns `true` if the audio engine is currently active. */
  get isStarted() {
    return this._started;
  }
};

// src/audio/AudioFrameBuffer.ts
var AudioFrameBuffer = class {
  /**
   * @param capacity     Total number of samples the ring buffer can hold.
   *                     Must be a positive integer.
   * @param sampleRate   Sample rate in Hz.  Default: 48000.
   * @param channelCount Number of interleaved channels.  Default: 2 (stereo).
   */
  constructor(capacity, sampleRate = 48e3, channelCount = 2) {
    this.head = 0;
    // next read position
    this.tail = 0;
    // next write position
    this.count = 0;
    if (capacity <= 0 || !Number.isInteger(capacity)) {
      throw new RangeError("[AudioFrameBuffer] capacity must be a positive integer");
    }
    this.data = new Float32Array(capacity);
    this.sampleRate = sampleRate;
    this.channelCount = channelCount;
  }
  // ─── Properties ───────────────────────────────────────────────────────────
  /** Total capacity of the ring buffer in samples. */
  get capacity() {
    return this.data.length;
  }
  /** Number of samples currently available for reading. */
  get available() {
    return this.count;
  }
  // ─── Write ────────────────────────────────────────────────────────────────
  /**
   * Append `length` samples from `samples` starting at `offset` into the
   * ring buffer.  When the buffer is full the oldest samples are overwritten.
   *
   * @param samples  Source sample array (any numeric array-like type).
   * @param offset   Index in `samples` to start reading from.  Default: 0.
   * @param length   Number of samples to copy.  Defaults to
   *                 `samples.length - offset`.
   */
  write(samples, offset = 0, length) {
    const len = length ?? samples.length - offset;
    const cap = this.data.length;
    for (let i = 0; i < len; i++) {
      this.data[this.tail] = samples[offset + i];
      this.tail = (this.tail + 1) % cap;
      if (this.count < cap) {
        this.count++;
      } else {
        this.head = (this.head + 1) % cap;
      }
    }
  }
  // ─── Read ─────────────────────────────────────────────────────────────────
  /**
   * Copy up to `out.length` (or `length`) samples out of the ring buffer into
   * `out`, consuming them.
   *
   * @param out     Destination typed array.
   * @param length  Maximum samples to read.  Defaults to `out.length`.
   * @returns       Actual number of samples copied.
   */
  read(out, length) {
    const len = Math.min(length ?? out.length, this.count);
    const cap = this.data.length;
    for (let i = 0; i < len; i++) {
      out[i] = this.data[this.head];
      this.head = (this.head + 1) % cap;
    }
    this.count -= len;
    return len;
  }
  /**
   * Copy up to `out.length` (or `length`) samples out of the ring buffer
   * without consuming them (non-destructive peek).
   *
   * @param out     Destination typed array.
   * @param length  Maximum samples to peek.  Defaults to `out.length`.
   * @returns       Actual number of samples copied.
   */
  peek(out, length) {
    const len = Math.min(length ?? out.length, this.count);
    const cap = this.data.length;
    let pos = this.head;
    for (let i = 0; i < len; i++) {
      out[i] = this.data[pos];
      pos = (pos + 1) % cap;
    }
    return len;
  }
  // ─── Utility ──────────────────────────────────────────────────────────────
  /**
   * Discard all buffered samples, resetting the ring buffer to an empty state.
   */
  clear() {
    this.head = 0;
    this.tail = 0;
    this.count = 0;
  }
  /**
   * Returns a snapshot of buffer metadata for diagnostics or speech-to-text
   * integration.
   */
  get info() {
    return {
      sampleRate: this.sampleRate,
      channelCount: this.channelCount,
      capacity: this.capacity,
      available: this.count
    };
  }
};

// src/audio/AudioFrameCapture.ts
var DEFAULT_BUFFER_DURATION_SECONDS = 4;
var AudioFrameCapture = class {
  /**
   * @param audioManager  The active ProximityAudioManager whose
   *                      {@link AudioContext} destination will be tapped via a
   *                      ScriptProcessorNode for decoded audio frames.
   * @param options       Optional buffer / stream configuration.
   */
  constructor(audioManager, options) {
    this._enabled = false;
    this.pollHandle = null;
    /** ScriptProcessorNode used to intercept audio flowing to the speakers and write it to the frame buffer. */
    this.scriptProcessorNode = null;
    /** Pre-allocated interleaved scratch buffer sized to the ScriptProcessorNode's buffer size × channel count. */
    this.interleavedBuffer = null;
    const sampleRate = options?.sampleRate ?? 48e3;
    const channelCount = options?.channelCount ?? 2;
    const bufferCapacity = options?.bufferCapacity ?? sampleRate * channelCount * DEFAULT_BUFFER_DURATION_SECONDS;
    this.audioManager = audioManager;
    this.frameBuffer = new AudioFrameBuffer(bufferCapacity, sampleRate, channelCount);
  }
  // ─── Lifecycle ────────────────────────────────────────────────────────────
  /**
   * Start capturing decoded audio frames.
   * Idempotent: calling while already enabled has no effect.
   *
   * Creates a ScriptProcessorNode to intercept audio flowing to the speakers
   * and capture the actual spatial audio output from MVRP.  The node passes
   * audio through unmodified so playback is unaffected.
   */
  enable() {
    if (this._enabled) return;
    const ctx = this.audioManager.getAudioContext();
    if (ctx) {
      this.scriptProcessorNode = ctx.createScriptProcessor(4096, 2, 2);
      this.interleavedBuffer = new Float32Array(4096 * 2);
      this.scriptProcessorNode.onaudioprocess = (event) => {
        const inputData = event.inputBuffer;
        const channelCount = inputData.numberOfChannels;
        const sampleCount = inputData.length;
        if (channelCount === 2 && this.interleavedBuffer) {
          const leftData = inputData.getChannelData(0);
          const rightData = inputData.getChannelData(1);
          for (let i = 0; i < sampleCount; i++) {
            this.interleavedBuffer[i * 2] = leftData[i];
            this.interleavedBuffer[i * 2 + 1] = rightData[i];
          }
          this.frameBuffer.write(this.interleavedBuffer, 0, sampleCount * 2);
        }
        for (let ch = 0; ch < channelCount; ch++) {
          event.outputBuffer.getChannelData(ch).set(event.inputBuffer.getChannelData(ch));
        }
      };
      this.scriptProcessorNode.connect(ctx.destination);
    }
    this._enabled = true;
    this.schedulePoll();
    console.log("[AudioFrameCapture] Capture enabled with ScriptProcessorNode");
  }
  /**
   * Stop capturing audio frames.  Any samples already in the ring buffer are
   * preserved and can still be read.  Playback is unaffected.
   * Idempotent: calling while already disabled has no effect.
   */
  disable() {
    if (!this._enabled) return;
    this._enabled = false;
    if (this.pollHandle !== null) {
      cancelAnimationFrame(this.pollHandle);
      this.pollHandle = null;
    }
    if (this.scriptProcessorNode) {
      this.scriptProcessorNode.disconnect();
      this.scriptProcessorNode = null;
      this.interleavedBuffer = null;
    }
    console.log("[AudioFrameCapture] Capture disabled");
  }
  /**
   * Disable capture and release all resources.
   * The instance must not be used after calling `dispose()`.
   */
  dispose() {
    this.disable();
  }
  // ─── Accessors ────────────────────────────────────────────────────────────
  /**
   * The underlying ring buffer.  Read from it to consume captured PCM samples.
   *
   * The buffer stores interleaved samples in the order they were decoded by
   * MVRP (typically L, R, L, R … for stereo streams).
   */
  get buffer() {
    return this.frameBuffer;
  }
  /** Sample rate of the captured audio (Hz). */
  get sampleRate() {
    return this.frameBuffer.sampleRate;
  }
  /** Number of interleaved channels stored in the ring buffer. */
  get channelCount() {
    return this.frameBuffer.channelCount;
  }
  /** `true` while the capture loop is running. */
  get isEnabled() {
    return this._enabled;
  }
  /**
   * Returns an AudioNode suitable for connecting to a tap or analysis chain.
   * Used by ProximityAudioManager to wire the ScriptProcessorNode into the
   * audio graph via AVStreamAudioPlayer.connectTap().
   */
  get processorNode() {
    return this.scriptProcessorNode;
  }
  /**
   * Convenience helper: discard all samples currently in the ring buffer.
   * Useful before starting a new utterance for speech-to-text.
   */
  clearBuffer() {
    this.frameBuffer.clear();
  }
  // ─── Poll loop ────────────────────────────────────────────────────────────
  schedulePoll() {
    const poll = () => {
      if (!this._enabled) return;
      this.pollHandle = requestAnimationFrame(poll);
      this.captureFrame();
    };
    this.pollHandle = requestAnimationFrame(poll);
  }
  /**
   * No-op: the ScriptProcessorNode's `onaudioprocess` callback handles all
   * capturing directly in the audio processing pipeline.  This method exists
   * only to keep the poll loop intact for consistency.
   */
  captureFrame() {
  }
};

// src/client/ProximityAvatarList.ts
var ProximityAvatarList = class {
  constructor() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.proximity = null;
    this.avatars = /* @__PURE__ */ new Map();
    this.localPosition = { x: 0, y: 0, z: 0 };
    this.localPersonaID = null;
    this.observers = /* @__PURE__ */ new Set();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.originalEmit = null;
    this.personaInfoCache = null;
  }
  /**
   * Initialize and hook into the Proximity instance.
   * Wraps Proximity's Emit method to intercept onAvatarUpdate events.
   *
   * @param proximity The MV.MVRP.Proximity instance from ProximityAudioManager
   * @param cache     Optional PersonaInfoCache for resolving avatar names
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  init(proximity, cache) {
    if (!proximity) {
      console.warn("[ProximityAvatarList] Proximity instance is null");
      return;
    }
    this.proximity = proximity;
    this.personaInfoCache = cache ?? null;
    this.setupProximityInterception();
    console.log("[ProximityAvatarList] Initialized and hooked into Proximity");
  }
  /**
   * Update the local persona's ID and Cartesian position.
   * Called from InWorldSession.teleportTo() whenever the user teleports.
   * This keeps the proximity list synchronized with the actual avatar position.
   *
   * @param personaID The local persona's ID
   * @param position The Cartesian position {x, y, z} in global coordinates
   */
  updateLocalPosition(personaID, position) {
    this.localPersonaID = personaID;
    this.localPosition = { x: position.x, y: position.y, z: position.z };
    console.log(
      "[ProximityAvatarList] Local position updated: persona",
      personaID,
      "at",
      position.x.toFixed(2),
      position.y.toFixed(2),
      position.z.toFixed(2)
    );
    this.recalculateDistances();
  }
  /**
   * Recalculate distances for all tracked avatars after local position changes.
   */
  recalculateDistances() {
    let changed = false;
    for (const [, avatar] of this.avatars) {
      const newDistance = this.calculateDistance(avatar.position);
      if (newDistance !== avatar.distance) {
        avatar.distance = newDistance;
        changed = true;
      }
    }
    if (changed) {
      console.log("[ProximityAvatarList] Distances recalculated for", this.avatars.size, "avatars");
      this.notifyObservers();
    }
  }
  /**
   * Intercept Proximity's Emit method to capture onAvatarUpdate events.
   * Similar to setupDecodeInterception in ProximityAudioManager.
   */
  setupProximityInterception() {
    if (!this.proximity || typeof this.proximity.Emit !== "function") {
      console.warn("[ProximityAvatarList] Proximity.Emit not found");
      return;
    }
    this.originalEmit = this.proximity.Emit;
    const self = this;
    this.proximity.Emit = function(eventName, ...args) {
      const result = self.originalEmit.apply(this, [eventName, ...args]);
      if (eventName === "onAvatarUpdate" && args.length > 0) {
        const eventData = args[0];
        self.handleAvatarUpdate(eventData);
      } else if (eventName === "onModelClose" && args.length > 0) {
        const dwRPersonaIx = args[0];
        console.log("[ProximityAvatarList] Intercepted onModelClose:", dwRPersonaIx);
        self.onModelClose(dwRPersonaIx);
      } else if (eventName === "onModelHide" && args.length > 0) {
        const dwRPersonaIx = args[0];
        console.log("[ProximityAvatarList] Intercepted onModelHide:", dwRPersonaIx);
        self.onModelHide(dwRPersonaIx);
      } else if (eventName === "onUserReady" && args.length >= 5) {
        const [, dwRPersonaIx, nX, nY, nZ] = args;
        console.log("[ProximityAvatarList] Intercepted onUserReady:", dwRPersonaIx);
        self.updateLocalPosition(dwRPersonaIx, { x: nX, y: nY, z: nZ });
      } else if (eventName === "onLogout_Client") {
        console.log("[ProximityAvatarList] Intercepted onLogout_Client");
        self.onLogout_Client(args[0] || false);
      }
      return result;
    };
    console.log("[ProximityAvatarList] Wrapped Proximity.Emit for event interception");
  }
  /**
   * Handle onAvatarUpdate event with batch avatar data.
   * The event contains:
   * - aSBA_RProximity_Avatar_Open_Ex: Array of persona IDs
   * - SBA_RProximity_Avatar_Update_Ex: Avatar state with position data
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handleAvatarUpdate(eventData) {
    if (!eventData) return;
    const avatarOpenExArray = eventData.aSBA_RProximity_Avatar_Open_Ex;
    const avatarUpdateEx = eventData.SBA_RProximity_Avatar_Update_Ex;
    if (!avatarUpdateEx) {
      console.warn("[ProximityAvatarList] No avatar update data in event");
      return;
    }
    const dwRPersonaIx = avatarUpdateEx.twRPersonaIx;
    if (dwRPersonaIx === this.localPersonaID) {
      return;
    }
    const pState = avatarUpdateEx.pState;
    if (!pState || !pState.pPosition_Head) {
      console.warn("[ProximityAvatarList] No position data in avatar update");
      return;
    }
    const positionHead = pState.pPosition_Head;
    const vPosition = positionHead?.pRelative?.vPosition;
    if (!vPosition) {
      console.warn("[ProximityAvatarList] No vPosition in pPosition_Head");
      return;
    }
    const position = {
      x: vPosition.dX,
      y: vPosition.dY,
      z: vPosition.dZ
    };
    const distance = this.calculateDistance(position);
    const isNew = !this.avatars.has(dwRPersonaIx);
    let name = "Unknown";
    if (avatarOpenExArray && Array.isArray(avatarOpenExArray)) {
      const avatarOpenEx = avatarOpenExArray.find((a) => a.twRPersonaIx === dwRPersonaIx);
      if (avatarOpenEx && avatarOpenEx.Name) {
        const forename = avatarOpenEx.Name.wszForename || "";
        const surname = avatarOpenEx.Name.wszSurname || "";
        name = (forename + " " + surname).trim() || "Unknown";
      }
    }
    if (!isNew) {
      const existing = this.avatars.get(dwRPersonaIx);
      if (existing) {
        name = existing.name;
      }
    }
    this.avatars.set(dwRPersonaIx, {
      personaID: dwRPersonaIx,
      name,
      position,
      distance
    });
    this.notifyObservers();
    if (isNew && this.personaInfoCache) {
      this.personaInfoCache.requestName(dwRPersonaIx, (resolvedName) => {
        const avatar = this.avatars.get(dwRPersonaIx);
        if (avatar && avatar.name !== resolvedName) {
          avatar.name = resolvedName;
          this.notifyObservers();
        }
      });
    }
  }
  /**
   * Proximity callback: External avatar has been removed from the world.
   * Called by Proximity when avatar leaves proximity/world.
   */
  onModelClose(dwRPersonaIx) {
    if (dwRPersonaIx === this.localPersonaID) {
      return;
    }
    console.log("[ProximityAvatarList] onModelClose:", dwRPersonaIx);
    if (this.avatars.has(dwRPersonaIx)) {
      this.avatars.delete(dwRPersonaIx);
      this.notifyObservers();
    }
  }
  /**
   * Avatar event callback: External avatar has gone out of range (hidden).
   */
  onModelHide(dwRPersonaIx) {
    if (dwRPersonaIx === this.localPersonaID) {
      return;
    }
    console.log("[ProximityAvatarList] onModelHide:", dwRPersonaIx);
    if (this.avatars.has(dwRPersonaIx)) {
      this.avatars.delete(dwRPersonaIx);
      this.notifyObservers();
    }
  }
  /**
   * Avatar event callback: User has logged out.
   * Clear all tracked avatars.
   */
  onLogout_Client(bVoluntary) {
    console.log("[ProximityAvatarList] onLogout_Client:", bVoluntary);
    this.avatars.clear();
    this.localPersonaID = null;
    this.notifyObservers();
  }
  /**
   * Calculate Euclidean distance from local avatar to remote avatar.
   * Handles world coordinates (dX, dY, dZ format).
   */
  calculateDistance(position) {
    const dx = position.x - this.localPosition.x;
    const dy = position.y - this.localPosition.y;
    const dz = position.z - this.localPosition.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  /**
   * Get the 10 closest avatars, sorted by distance.
   */
  getClosestAvatars(count = 10) {
    return Array.from(this.avatars.values()).sort((a, b) => a.distance - b.distance).slice(0, count);
  }
  /**
   * Register an observer to be notified when the avatar list changes.
   */
  addObserver(callback) {
    this.observers.add(callback);
  }
  /**
   * Remove an observer.
   */
  removeObserver(callback) {
    this.observers.delete(callback);
  }
  /**
   * Notify all observers of avatar list changes.
   */
  notifyObservers() {
    const closestAvatars = this.getClosestAvatars(10);
    for (const observer of this.observers) {
      observer(closestAvatars);
    }
  }
  /**
   * Clean up: Unwrap Proximity if needed.
   */
  dispose() {
    if (this.proximity && this.originalEmit) {
      try {
        this.proximity.Emit = this.originalEmit;
        console.log("[ProximityAvatarList] Unwrapped Proximity.Emit");
      } catch (err) {
        console.error("[ProximityAvatarList] Error during cleanup:", err);
      }
    }
    this.avatars.clear();
    this.observers.clear();
    this.proximity = null;
    this.originalEmit = null;
  }
};

// src/client/PersonaInfoCache.ts
var _PersonaInfoCache = class _PersonaInfoCache {
  constructor() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.cacheLnG = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.personaCache = null;
    /** Resolved names keyed by numeric persona ID. */
    this.nameCache = /* @__PURE__ */ new Map();
    /** Callbacks waiting for a name, keyed by numeric persona ID. */
    this.pendingCallbacks = /* @__PURE__ */ new Map();
    /** Persona IDs queued for the next batched Fetch call. */
    this.fetchQueue = /* @__PURE__ */ new Set();
    /** Timer handle for the batched fetch. */
    this.batchTimer = null;
    try {
      const pFabric2 = getPFabric();
      if (!pFabric2) {
        console.warn("[PersonaInfoCache] pFabric not available; names will not be fetched");
        return;
      }
      this.cacheLnG = pFabric2.GetLnG("persona_cache");
      if (!this.cacheLnG) {
        console.warn('[PersonaInfoCache] GetLnG("persona_cache") returned null');
        return;
      }
      this.personaCache = this.cacheLnG.Model_Open("RPersona_Cache");
      if (!this.personaCache) {
        console.warn('[PersonaInfoCache] Model_Open("RPersona_Cache") returned null');
        return;
      }
      console.log("[PersonaInfoCache] Initialized \u2014 RPersona_Cache model ready");
    } catch (err) {
      console.error("[PersonaInfoCache] Error during initialization:", err);
    }
  }
  /**
   * Request the display name for a persona.
   *
   * If the name is already cached it is returned synchronously via the
   * callback.  Otherwise the ID is queued and the callback is invoked once
   * the next batched `Fetch()` call completes.
   *
   * @param personaID Numeric persona ID (`twRPersonaIx`).
   * @param callback  Called with the resolved display name (e.g. "Jane Smith").
   */
  requestName(personaID, callback) {
    const cached = this.nameCache.get(personaID);
    if (cached !== void 0) {
      callback(cached);
      return;
    }
    const existing = this.pendingCallbacks.get(personaID);
    if (existing) {
      existing.push(callback);
    } else {
      this.pendingCallbacks.set(personaID, [callback]);
    }
    this.fetchQueue.add(personaID);
    if (this.batchTimer === null) {
      this.batchTimer = setTimeout(() => this.flushFetchQueue(), _PersonaInfoCache.BATCH_DELAY_MS);
    }
  }
  /**
   * Flush the queued persona IDs with a single `RPersona_Cache.Fetch()` call.
   */
  flushFetchQueue() {
    this.batchTimer = null;
    if (!this.personaCache || this.fetchQueue.size === 0) {
      return;
    }
    const ids = Array.from(this.fetchQueue);
    this.fetchQueue = /* @__PURE__ */ new Set();
    console.log("[PersonaInfoCache] Fetching names for persona IDs:", ids);
    try {
      this.personaCache.Fetch(ids, this, (response) => {
        this.handleFetchResponse(response, ids);
      });
    } catch (err) {
      console.error("[PersonaInfoCache] Fetch error:", err);
      for (const id of ids) {
        this.resolveName(id, `Avatar ${id}`);
      }
    }
  }
  /**
   * Process the response from `RPersona_Cache.Fetch()`.
   *
   * The response is a record keyed by string persona ID; each value is an
   * object that includes `Name_wsForename`, `Name_wsSurname`, etc.
   * `requestedIds` is the list of IDs that were sent in this specific Fetch
   * call; any IDs missing from the response receive a fallback name.
   */
  handleFetchResponse(response, requestedIds) {
    if (!response || typeof response !== "object") {
      console.warn("[PersonaInfoCache] Unexpected Fetch response:", response);
      for (const id of requestedIds) {
        this.resolveName(id, `Avatar ${id}`);
      }
      return;
    }
    const resolved = /* @__PURE__ */ new Set();
    for (const [key, data] of Object.entries(response)) {
      const personaID = Number(key);
      if (isNaN(personaID)) continue;
      const forename = typeof data?.Name_wsForename === "string" ? data.Name_wsForename : "";
      const surname = typeof data?.Name_wsSurname === "string" ? data.Name_wsSurname : "";
      const displayName = [forename, surname].filter(Boolean).join(" ") || `Avatar ${personaID}`;
      this.resolveName(personaID, displayName);
      resolved.add(personaID);
    }
    for (const id of requestedIds) {
      if (!resolved.has(id)) {
        const fallback = `Avatar ${id}`;
        console.warn(`[PersonaInfoCache] No data for persona ${id}; using fallback "${fallback}"`);
        this.resolveName(id, fallback);
      }
    }
  }
  /**
   * Store a resolved name in the cache and invoke all waiting callbacks.
   */
  resolveName(personaID, name) {
    this.nameCache.set(personaID, name);
    const callbacks = this.pendingCallbacks.get(personaID);
    if (callbacks) {
      this.pendingCallbacks.delete(personaID);
      for (const cb of callbacks) {
        try {
          cb(name);
        } catch (err) {
          console.error("[PersonaInfoCache] Callback error for persona", personaID, err);
        }
      }
    }
  }
  /**
   * Release the RPersona_Cache model and cancel any pending timer.
   */
  dispose() {
    if (this.batchTimer !== null) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    for (const [id, callbacks] of this.pendingCallbacks) {
      for (const cb of callbacks) {
        try {
          cb(`Avatar ${id}`);
        } catch (_) {
        }
      }
    }
    this.pendingCallbacks.clear();
    this.fetchQueue.clear();
    if (this.personaCache && this.cacheLnG) {
      try {
        this.cacheLnG.Model_Close(this.personaCache);
      } catch (err) {
        console.error("[PersonaInfoCache] Error closing model:", err);
      }
      this.personaCache = null;
    }
    this.cacheLnG = null;
    this.nameCache.clear();
    console.log("[PersonaInfoCache] Disposed");
  }
};
/** How long (ms) to accumulate IDs before issuing a Fetch call. */
_PersonaInfoCache.BATCH_DELAY_MS = 500;
var PersonaInfoCache = _PersonaInfoCache;

// src/client/AudioVisualizer.ts
var _AudioVisualizer = class _AudioVisualizer {
  constructor(container, options) {
    // MVRP audio manager reference (set in attachAudioSource)
    this.audioManager = null;
    // AudioFrameCapture tap used to read decoded PCM from the MVRP stream
    this.audioCapture = null;
    // ProximityAvatarList tracks nearby avatars and updates the proximity panel
    this.proximityList = null;
    this.personaInfoCache = null;
    this.proximityPanel = null;
    // Scratch buffer for reading PCM samples from the audioCapture ring buffer
    this.readBuffer = new Float32Array(960);
    // Frame skip counter – discard the first N frames to let the buffer fill
    this.frameSkipCounter = 0;
    this.FRAME_SKIP_THRESHOLD = 5;
    // Skip first 5 frames
    // Current L/R amplitude levels (0–1) read from MVRP or set via update()
    this.levelL = 0;
    this.levelR = 0;
    // Frame counter used for periodic diagnostic logging in drawFrame()
    this.frameCount = 0;
    // requestAnimationFrame handle
    this.animFrameId = null;
    // Circular buffers for L/R channel amplitude samples (values in 0–1)
    this.sampleBufferL = new Float32Array(_AudioVisualizer.BUFFER_SIZE);
    this.sampleBufferR = new Float32Array(_AudioVisualizer.BUFFER_SIZE);
    // Write cursor; the oldest sample lives at this index
    this.bufferIndex = 0;
    this.container = container;
    this.opts = {
      backgroundColor: options?.backgroundColor ?? "rgba(0,0,0,0.45)",
      colorLeft: options?.colorLeft ?? "#00eaff",
      colorRight: options?.colorRight ?? "#ff00cc"
    };
    this.canvas = document.createElement("canvas");
    this.canvas.className = "audio-visualizer-canvas";
    this.canvas.width = 280;
    this.canvas.height = 240;
    container.appendChild(this.canvas);
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("[AudioVisualizer] Canvas 2D context unavailable");
    this.ctx2d = ctx;
    this.drawFrame();
    this.proximityPanel = document.getElementById("proximity-panel");
  }
  // ─── Integration ────────────────────────────────────────────────────────────
  /**
   * Wire the visualizer into the live audio stream managed by `audioManager`.
   *
   * Creates an {@link AudioFrameCapture} and enables it to tap the MVRP audio
   * stream, buffering decoded PCM samples for each animation frame.
   * The frame skip counter discards the first {@link FRAME_SKIP_THRESHOLD}
   * frames to allow the capture buffer to fill with real audio data before
   * feeding samples to `updateFromPcm()`.
   *
   * Starts the requestAnimationFrame draw loop automatically.
   * Idempotent: subsequent calls have no effect while a source is already
   * attached.
   */
  attachAudioSource(audioManager) {
    if (this.audioManager) return;
    const proximity = audioManager.getProximity();
    if (!proximity) {
      console.warn("[AudioVisualizer] Proximity not ready");
      return;
    }
    this.audioManager = audioManager;
    this.audioCapture = new AudioFrameCapture(audioManager);
    this.audioCapture.enable();
    audioManager.registerDecodeCapture(this.audioCapture);
    console.log("[AudioVisualizer] Capture attached to decode interceptor");
    this.proximityList = new ProximityAvatarList();
    this.personaInfoCache = new PersonaInfoCache();
    this.proximityList.init(proximity, this.personaInfoCache);
    this.proximityList.addObserver((avatars) => this.updateProximityPanel(avatars));
    this.proximityPanel = document.getElementById("proximity-panel");
    console.log("[AudioVisualizer] Proximity avatar list initialized");
    this.startLoop();
    console.log("[AudioVisualizer] Attached to audio source; visualizer active");
  }
  /**
   * Detach from the current audio source, stop the animation loop, and release
   * the AudioFrameCapture.  The canvas remains in the DOM.
   * Idempotent: calling when no source is attached has no effect.
   */
  detachAudioSource() {
    if (this.audioManager) {
      this.audioManager.unregisterDecodeCapture();
      console.log("[AudioVisualizer] Capture detached from decode interceptor");
    }
    if (this.audioCapture) {
      this.audioCapture.disable();
      this.audioCapture.dispose();
      this.audioCapture = null;
    }
    if (this.personaInfoCache) {
      this.personaInfoCache.dispose();
      this.personaInfoCache = null;
    }
    if (this.proximityList) {
      this.proximityList.dispose();
      this.proximityList = null;
    }
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    this.audioManager = null;
  }
  /**
   * Update the local avatar's persona ID and position in the proximity list.
   * Called from InWorldSession.teleportTo() to keep distance calculations accurate.
   *
   * @param personaID The local persona's numeric ID
   * @param position The Cartesian position {x, y, z} in global coordinates
   */
  updateProximityListPosition(personaID, position) {
    if (this.proximityList) {
      this.proximityList.updateLocalPosition(personaID, position);
    }
  }
  /**
   * Push normalised L/R amplitude values directly into the visualizer.
   *
   * Appends one sample to the circular buffers and redraws.
   * Useful for testing.  Values should be in the range 0–1.
   */
  update(levelL, levelR) {
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
   * This method provides a direct PCM path and is the preferred route for
   * feeding speech-to-text pipelines that already hold a decoded PCM slice.
   *
   * @param samples       Interleaved PCM samples (numeric array-like).
   * @param channelCount  Channels interleaved in `samples`.  Default: 2.
   * @param normalize     When `true` the values are treated as signed int16
   *                      (range −32 768 … +32 767) and divided by 32 768 to
   *                      produce a 0–1 amplitude.  Set to `false` when samples
   *                      are already normalised.  Default: `true`.
   */
  updateFromPcm(samples, channelCount = 2, normalize = true) {
    if (samples.length === 0) return;
    const scale = normalize ? 32768 : 1;
    let sumSqL = 0;
    let sumSqR = 0;
    const frames = Math.floor(samples.length / channelCount);
    if (channelCount >= 2) {
      for (let i = 0; i < frames; i++) {
        const l = samples[i * 2] / scale;
        const r = samples[i * 2 + 1] / scale;
        sumSqL += l * l;
        sumSqR += r * r;
      }
      this.levelL = Math.min(Math.sqrt(sumSqL / (frames || 1)), 1);
      this.levelR = Math.min(Math.sqrt(sumSqR / (frames || 1)), 1);
    } else {
      for (let i = 0; i < samples.length; i++) {
        const v = samples[i] / scale;
        sumSqL += v * v;
      }
      const rms = Math.min(Math.sqrt(sumSqL / (samples.length || 1)), 1);
      this.levelL = rms;
      this.levelR = rms;
    }
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
  dispose() {
    this.stopLoop();
    this.frameSkipCounter = 0;
    if (this.audioCapture) {
      if (this.audioManager) {
        this.audioManager.unregisterDecodeCapture();
      }
      this.audioCapture.disable();
      this.audioCapture.dispose();
      this.audioCapture = null;
    }
    if (this.personaInfoCache) {
      this.personaInfoCache.dispose();
      this.personaInfoCache = null;
    }
    if (this.proximityList) {
      this.proximityList.dispose();
      this.proximityList = null;
    }
    this.audioManager = null;
    this.proximityPanel = null;
    if (this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas);
    }
    console.log("[AudioVisualizer] Disposed");
  }
  // ─── Animation loop ─────────────────────────────────────────────────────────
  startLoop() {
    if (this.animFrameId !== null) return;
    this.frameSkipCounter = 0;
    const tick = () => {
      this.animFrameId = requestAnimationFrame(tick);
      if (this.audioCapture) {
        if (this.frameSkipCounter < this.FRAME_SKIP_THRESHOLD) {
          this.frameSkipCounter++;
          this.audioCapture.buffer.read(this.readBuffer);
        } else {
          const n = this.audioCapture.buffer.read(this.readBuffer);
          if (n > 0) {
            this.updateFromPcm(this.readBuffer.subarray(0, n), 2, false);
          }
        }
      }
      this.drawFrame();
    };
    this.animFrameId = requestAnimationFrame(tick);
  }
  stopLoop() {
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }
  // ─── Rendering ──────────────────────────────────────────────────────────────
  /**
   * Write the current L/R levels into the circular sample buffers and advance
   * the write cursor, overwriting the oldest sample when the buffer is full.
   */
  pushSample(l, r) {
    this.sampleBufferL[this.bufferIndex] = l;
    this.sampleBufferR[this.bufferIndex] = r;
    this.bufferIndex = (this.bufferIndex + 1) % _AudioVisualizer.BUFFER_SIZE;
  }
  drawFrame() {
    this.frameCount++;
    const { width, height } = this.canvas;
    const c = this.ctx2d;
    const halfH = height / 2;
    c.fillStyle = this.opts.backgroundColor;
    c.fillRect(0, 0, width, height);
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
  drawWaveform(buffer, yTop, areaH, color) {
    const c = this.ctx2d;
    const n = _AudioVisualizer.BUFFER_SIZE;
    const centerY = yTop + areaH / 2;
    const halfAreaH = areaH / 2;
    c.strokeStyle = color;
    c.lineWidth = 1;
    c.beginPath();
    for (let x = 0; x < n; x++) {
      const sampleIdx = (this.bufferIndex + x) % n;
      const amp = buffer[sampleIdx] ?? 0;
      const lineH = amp * halfAreaH;
      c.moveTo(x, centerY - lineH);
      c.lineTo(x, centerY + lineH);
    }
    c.stroke();
  }
  /**
   * Update the proximity panel with a table of the 10 closest avatars.
   * DOM nodes are constructed via the DOM API to prevent XSS from avatar names.
   */
  updateProximityPanel(avatars) {
    if (!this.proximityPanel) return;
    this.proximityPanel.textContent = "";
    const header = document.createElement("div");
    header.className = "proximity-header";
    if (avatars.length === 0) {
      header.textContent = "Nearby Avatars";
      this.proximityPanel.appendChild(header);
      const empty = document.createElement("div");
      empty.className = "proximity-empty";
      empty.textContent = "None in range";
      this.proximityPanel.appendChild(empty);
      return;
    }
    header.textContent = `Nearby Avatars (${avatars.length})`;
    this.proximityPanel.appendChild(header);
    const table = document.createElement("table");
    table.className = "proximity-table";
    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    for (const label of ["Avatar ID", "Name", "Distance"]) {
      const th = document.createElement("th");
      th.textContent = label;
      headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);
    const tbody = document.createElement("tbody");
    for (const a of avatars) {
      const tr = document.createElement("tr");
      const idTd = document.createElement("td");
      idTd.className = "proximity-id";
      idTd.textContent = String(a.personaID);
      const nameTd = document.createElement("td");
      nameTd.className = "proximity-name";
      nameTd.textContent = a.name;
      const distTd = document.createElement("td");
      distTd.className = "proximity-distance";
      distTd.textContent = `${a.distance.toFixed(2)}m`;
      tr.appendChild(idTd);
      tr.appendChild(nameTd);
      tr.appendChild(distTd);
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    this.proximityPanel.appendChild(table);
  }
};
// ─── Rolling sample buffers ──────────────────────────────────────────────────
// Number of samples kept (one per canvas pixel width)
_AudioVisualizer.BUFFER_SIZE = 280;
var AudioVisualizer = _AudioVisualizer;

// src/client/InWorldSession.ts
var InWorldSession = class extends Session {
  constructor(personaInfo, personaSession) {
    super();
    this.puppet = null;
    this.audioManager = null;
    this.visualizer = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.pTime = null;
    /**
     * Called by pTime on each internal tick when this session is attached via
     * `pTime.Attach(this)`. Delegates to PersonaSession's onTick() handler
     * so avatar-update callbacks fire within the MVRP event loop (not from
     * setInterval or manual calls).
     */
    this.lastServerTime = 0;
    this.personaInfo = personaInfo;
    this.personaSession = personaSession;
  }
  get avatar() {
    return this.puppet;
  }
  /** Returns the active ProximityAudioManager, or null before connect(). */
  get audio() {
    return this.audioManager;
  }
  async connect() {
    this.setState("EnteringWorld" /* EnteringWorld */);
    this.puppet = new PersonaPuppet(this.personaInfo, this);
    await this.puppet.spawn();
    const pLnG = this.personaSession.pLnGClient;
    if (pLnG) {
      this.audioManager = new ProximityAudioManager(pLnG);
      this.audioManager.start();
      const vizContainer = document.getElementById("audio-visualizer-container");
      if (vizContainer) {
        this.visualizer = new AudioVisualizer(vizContainer);
        this.visualizer.attachAudioSource(this.audioManager);
      }
    } else {
      console.warn("[InWorldSession] pLnGClient unavailable; proximity audio disabled");
    }
    const pClient = pLnG?.pClient ?? null;
    this.pTime = pClient?.Time_Open?.() ?? null;
    if (this.pTime) {
      this.pTime.Attach(this);
      console.log("[InWorldSession] pTime opened and attached for tick-driven avatar updates");
    } else {
      console.warn("[InWorldSession] pTime unavailable; avatar updates will not fire");
    }
    this.setState("InWorld" /* InWorld */);
  }
  async disconnect() {
    if (this.pTime) {
      this.pTime.Detach(this);
      this.pTime = null;
    }
    if (this.visualizer) {
      this.visualizer.dispose();
      this.visualizer = null;
    }
    if (this.audioManager) {
      this.audioManager.stop();
      this.audioManager = null;
    }
    if (this.puppet) {
      await this.puppet.despawn();
      this.puppet = null;
    }
    this.setState("Disconnected" /* Disconnected */);
  }
  onTick(pNotice) {
    this.lastServerTime = pNotice.pData.tmServer;
    try {
      this.personaSession.onTick();
    } catch (err) {
      console.error("[InWorldSession] onTick delegation error:", err);
    }
  }
  teleportTo(celestialId, position) {
    if (!this.personaSession || !this.personaSession.pRPersona) {
      console.error("[InWorldSession] No PersonaSession or pRPersona for teleport");
      return;
    }
    if (this.visualizer) {
      const personaId = this.personaSession.personaId;
      this.visualizer.updateProximityListPosition(Number(personaId), position);
      console.log("[InWorldSession] Updated ProximityAvatarList with teleport position");
    }
    try {
      const pRPersona = this.personaSession.pRPersona;
      const tmStamp = this.lastServerTime || Date.now();
      const updatePayload = {
        tmStamp,
        pState: {
          bControl: 0,
          bVolume: 0,
          wFlag: 0,
          bSerial_A: 0,
          bSerial_B: 0,
          wOrder: 0,
          bCoordSys: 156,
          // Universal coordinate system (matches RP1Demo PersonaPuppet)
          pPosition_Head: {
            pParent: {
              twObjectIx: Number(celestialId),
              wClass: 71
              // MapModelType.Celestial
            },
            pRelative: {
              vPosition: {
                dX: position.x,
                dY: position.y,
                dZ: position.z
              }
            }
          },
          pRotation_Head: {
            dwV: pRPersona.Quat_Encode([0.7071068, 0, 0, 0.7071068])
          },
          pRotation_Body: {
            dwV: pRPersona.Quat_Encode([0.7071068, 0, 0, 0.7071068])
          },
          pPosition_Hand_Left: {
            dwV: pRPersona.Vect_Encode([-0.2, -0.6, -0.1])
          },
          pRotation_Hand_Left: {
            dwV: pRPersona.Quat_Encode([0, 0, 0, 1])
          },
          pPosition_Hand_Right: {
            dwV: pRPersona.Vect_Encode([0.2, -0.6, -0.1])
          },
          pRotation_Hand_Right: {
            dwV: pRPersona.Quat_Encode([0, 0, 0, 1])
          },
          bHand_Left: Array.from(new Uint8Array(6)),
          // Default neutral hand grip (all zeros)
          bHand_Right: Array.from(new Uint8Array(6)),
          // Default neutral hand grip (all zeros)
          bFace: [24, 23, 22, 21]
          // Default neutral face expression
        },
        wSamples: 0,
        wCodec: 0,
        wSize: 0,
        abData: new Uint8Array(0)
      };
      pRPersona.Send("UPDATE", updatePayload);
    } catch (err) {
      console.error("[InWorldSession] UPDATE Send failed:", err);
      throw err;
    }
  }
};

// src/client/PersonaSession.ts
function promisifyAction(pModel, sAction, pData, callback) {
  return new Promise((resolve, reject) => {
    const sent = pModel.Send(sAction, pData, null, async (pIAction) => {
      try {
        resolve(await callback(pIAction));
      } catch (err) {
        reject(err);
      }
    });
    if (!sent) {
      reject(new Error(`[promisifyAction] Failed to send action '${sAction}'`));
    }
  });
}
var PersonaSession = class extends Session {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(personaId, pLnG, pRUser, firstName, lastName, anyLoginClient = null) {
    super();
    this.inWorldSession = null;
    this._personaInfo = null;
    // pRPersona instance from @metaversalcorp/mvrp.
    // Type is kept as `unknown` because the private package cannot be resolved
    // in open-source builds; cast to the real type when the package is available.
    // import('@metaversalcorp/mvrp').RPersona
    this._pRPersona = null;
    // ─── Avatar update state ──────────────────────────────────────────────────
    /** Whether a periodic avatar update cycle is currently active. */
    this._avatarUpdateActive = false;
    /** Tracks whether an avatar update is pending (in-progress or queued). */
    this.avatarUpdatePending = false;
    /** Callback provided by the caller for each avatar update tick. */
    this._onAvatarUpdate = null;
    /** Timestamp of the last avatar update send; used to throttle MVRP ticks to ~64 Hz. */
    this.lastAvatarUpdateTick = 0;
    /** Minimum interval (ms) between avatar updates (~64 Hz, matching RP1 demo update rate). */
    this.avatarUpdateIntervalMs = 15.625;
    this._loginClient = null;
    this.personaId = personaId;
    this.pLnG = pLnG;
    this.pRUser = pRUser;
    this._firstName = firstName;
    this._lastName = lastName;
    this._loginClient = anyLoginClient;
  }
  get personaInfo() {
    return this._personaInfo;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  get pLnGClient() {
    return this.pLnG;
  }
  get pRPersona() {
    return this._pRPersona;
  }
  async connect() {
    this.setState("Connecting" /* Connecting */);
    if (!this.pLnG) {
      throw new Error(`[PersonaSession] pLnG is not available; cannot open RPersona model`);
    }
    console.log(`[PersonaSession] Opening RPersona model for ${this.personaId}...`);
    const pRPersona = this.pLnG.Model_Open("RPersona", `${this.personaId}`);
    if (!pRPersona) {
      throw new Error(`[PersonaSession] Model_Open('RPersona', '${this.personaId}') returned null`);
    }
    this._pRPersona = pRPersona;
    console.log(`[PersonaSession] RPersona model opened successfully`);
    this._pRPersona.Attach(this);
    console.log(`[PersonaSession] Entering world...`);
    await this.enterPersona();
    this._personaInfo = new PersonaInfo(
      this.personaId,
      [this._firstName, this._lastName].filter(Boolean).join(" ") || `Persona_${this.personaId}`,
      "",
      "default_world",
      "default_region"
    );
    this.inWorldSession = new InWorldSession(this._personaInfo, this);
    await this.inWorldSession.connect();
    console.log(`[PersonaSession] Connected! In world as persona ${this.personaId}`);
    this.setState("InWorld" /* InWorld */);
  }
  /**
   * Enter the world with this persona by sending RPERSONA_ENTER on pRUser (matching RP1Demo flow).
   * Sends position data matching RP1Demo's guest flow.
   * PersonaPuppet then handles ongoing position updates.
   */
  async enterPersona() {
    if (!this._pRPersona) {
      throw new Error("[PersonaSession] RPersona model not open");
    }
    if (!this.pRUser) {
      throw new Error("[PersonaSession] pRUser not available for RPERSONA_ENTER");
    }
    const pPosition = {
      pParent: {
        twObjectIx: 104,
        // startingLocationCelestialID (RP1Demo default)
        wClass: 71
        // metaversal/rp1 celestial object class
      },
      pRelative: {
        vPosition: [50, 25, 6370999999e-3]
        // default geopos: lon=50°, lat=25°, radius≈6371km
      }
    };
    console.log(`[enterPersona] Calling RPERSONA_ENTER on pRUser for persona ${this.personaId}`);
    return promisifyAction(
      this.pRUser,
      "RPERSONA_ENTER",
      {
        twRPersonaIx: Number(this.personaId),
        twSessionIz: 0,
        pPosition
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async (pIAction) => {
        const result = pIAction.GetResult();
        console.log(`[enterPersona] RPERSONA_ENTER result: ${result}`);
        if (result !== 0) {
          const errorName = this.getErrorName(result);
          if (result == 3200) {
            console.warn(`[enterPersona] Persona ${this.personaId} is already in the world;
Wait 60 seconds and retry. (Remember to logout when leaving the page)`);
            if (this._loginClient) {
              this._loginClient.updateStatusBadge("refresh-required");
              this._loginClient.appendStatus(`[enterPersona] Persona ${this.personaId} is still connected;`);
              this._loginClient.appendStatus(`Wait 60 seconds and REFRESH. (Remember to logout when leaving the page)`);
            }
            throw new Error(`RPERSONA_ENTER failed: ${result} (${errorName})`);
          }
        }
      }
    );
  }
  /**
   * Map MV error codes to readable names (from MV Library).
   */
  getErrorName(code) {
    const errors = {
      0: "SUCCESS",
      [-3]: "INVALIDOBJECT",
      [-18]: "INVALIDSESSION",
      [-34]: "INVALIDUSERSESSION",
      [-36]: "INVALIDUSER",
      [-37]: "INVALIDRIGHTS",
      [-40]: "INVALIDSTATE",
      [-45]: "INVALIDGUEST"
    };
    return errors[code] ?? `UNKNOWN_ERROR_${code}`;
  }
  /** Relay a teleport command to the active in-world session. */
  teleportTo(celestialId, position) {
    if (!this.inWorldSession) {
      console.error("[PersonaSession] No InWorldSession for teleport");
      return;
    }
    this.inWorldSession.teleportTo(celestialId, position);
  }
  /** Returns the active InWorldSession, or `null` if not yet in-world. */
  get inWorld() {
    return this.inWorldSession;
  }
  // ─── MVRP tick handler ────────────────────────────────────────────────────
  /**
   * Called by MVRP on each internal tick when this session is attached via
   * `pRPersona.Attach(this)`. Fires avatar updates inside the MVRP event loop
   * so that Send() calls are accepted by the state machine. Updates are
   * throttled to ~64 Hz (every 16 ms) to avoid flooding the server.
   */
  onTick() {
    if (!this._avatarUpdateActive || !this._onAvatarUpdate) return;
    const now = Date.now();
    if (now - this.lastAvatarUpdateTick < this.avatarUpdateIntervalMs) return;
    this.lastAvatarUpdateTick = now;
    this.avatarUpdatePending = true;
    try {
      this._onAvatarUpdate();
    } catch (err) {
      console.error("[PersonaSession] Avatar update error in onTick:", err);
    } finally {
      this.avatarUpdatePending = false;
    }
  }
  /**
   * Register (or clear) the avatar-update callback driven by pTime's onTick() tick.
   * Passing `null` deactivates updates (equivalent to stopAvatarUpdates()).
   *
   * When a non-null callback is set, `PersonaSession.onTick()` (invoked by
   * `InWorldSession.onTick()` on each pTime tick) will call the callback
   * once per throttle interval (~64 Hz / every 15.625 ms).
   *
   * @param callback - Called on every pTime tick while updates are active (throttled to ~64 Hz),
   *                   or `null` to stop updates.
   */
  setAvatarUpdateCallback(callback) {
    this._onAvatarUpdate = callback;
    this._avatarUpdateActive = callback !== null;
    if (callback) {
      this.lastAvatarUpdateTick = 0;
      this.avatarUpdatePending = false;
      console.log("[PersonaSession] Avatar update callback registered (pTime-driven)");
    } else {
      console.log("[PersonaSession] Avatar update callback cleared");
    }
  }
  /**
   * Enable periodic avatar updates driven by MVRP's onTick() tick.
   * @param callback - Called on every MVRP tick while updates are active (throttled to ~64 Hz).
   */
  startAvatarUpdates(callback) {
    this._onAvatarUpdate = callback;
    this._avatarUpdateActive = true;
    this.lastAvatarUpdateTick = 0;
    this.avatarUpdatePending = false;
    console.log("[PersonaSession] Avatar updates started (MVRP-driven)");
  }
  /** Stop periodic avatar updates. */
  stopAvatarUpdates() {
    this._avatarUpdateActive = false;
    this._onAvatarUpdate = null;
    this.avatarUpdatePending = false;
    console.log("[PersonaSession] Avatar updates stopped");
  }
  /**
   * Queue an immediate avatar update to fire on the next eligible MVRP tick,
   * bypassing the normal throttle interval. Has no effect if avatar updates
   * are not currently active.
   */
  triggerAvatarUpdate() {
    if (!this._avatarUpdateActive) return;
    this.lastAvatarUpdateTick = 0;
    this.avatarUpdatePending = true;
  }
  async disconnect() {
    this.stopAvatarUpdates();
    if (this.inWorldSession) {
      await this.inWorldSession.disconnect();
      this.inWorldSession = null;
    }
    if (this.pLnG && this._pRPersona) {
      this.pLnG.Model_Close(this._pRPersona);
    }
    this._pRPersona = null;
    this.pLnG = null;
    this._personaInfo = null;
    this.pRUser = null;
    this.setState("Disconnected" /* Disconnected */);
  }
};

// src/client/UserSession.ts
var UserSession = class extends Session {
  /**
   * Constructor now gets pLnG from MSF fabric via getPFabric().
   * This follows RP1Demo pattern: Model_Open + Attach in constructor.
   */
  constructor(user, anyLoginClient = null) {
    super();
    this._personaSession = null;
    this._ownPersonaList = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this._friendsService = null;
    this._loginClient = null;
    this.user = user;
    this._loginClient = anyLoginClient;
    const pLnG = getPFabric()?.pLnG;
    if (!pLnG) {
      throw new Error("[UserSession] pLnG not available from MSF fabric");
    }
    this.pLnG = pLnG;
    console.log(`[UserSession] Opening RUser model for user ${user.id}...`);
    this.pRUser = pLnG.Model_Open("RUser", user.id);
    if (!this.pRUser) {
      throw new Error(`[UserSession] Model_Open('RUser', '${user.id}') returned null`);
    }
    console.log(`[UserSession] RUser model opened, attaching listener`);
    this.pRUser.Attach(this);
  }
  get userId() {
    return this.user.id;
  }
  get username() {
    return this.user.displayName;
  }
  get ownPersonaList() {
    return this._ownPersonaList;
  }
  /**
   * Initialize the UserSession connection state.
   * Model_Open + Attach already happened in constructor.
   */
  async connect() {
    this.setState("Connecting" /* Connecting */);
    console.log("[UserSession] Connected (pRUser already initialized in constructor)");
    this.setState("Connected" /* Connected */);
  }
  /**
   * Called by MV library when pRUser ready state changes.
   * Enumerates existing personas when RUser is RECOVERED.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onReadyState(pNotice) {
    if (pNotice.pCreator !== this.pRUser) return;
    const readyState = this.pRUser.ReadyState?.();
    console.log("[UserSession] onReadyState fired, readyState:", readyState);
    if (this.pRUser.eSTATE?.RECOVERED !== void 0 && readyState === this.pRUser.eSTATE.RECOVERED) {
      console.log("[UserSession] RUser state is RECOVERED, enumerating personas...");
      this.enumeratePersonas();
    }
  }
  /**
   * Enumerate existing personas using Child_Enum like RP1Demo does.
   */
  enumeratePersonas() {
    const enumCallback = (rPersona) => {
      const personaId = rPersona.twRPersonaIx;
      const personaName = rPersona.pName;
      const displayName = [personaName?.wsForename, personaName?.wsSurname].filter(Boolean).join(" ") || `Persona_${personaId}`;
      const persona = {
        id: String(personaId),
        displayName,
        firstName: personaName?.wsForename || "",
        lastName: personaName?.wsSurname || ""
      };
      this._ownPersonaList.push(persona);
      console.log(`[UserSession] Found persona: ${displayName} (ID: ${personaId})`);
      return true;
    };
    try {
      this.pRUser.Child_Enum("RPersona", this, enumCallback);
      console.log(`[UserSession] Persona enumeration complete. Found ${this._ownPersonaList.length} personas`);
    } catch (err) {
      console.error("[UserSession] Child_Enum failed:", err);
    }
  }
  /**
   * Enter the world with the selected persona.
   */
  async pickPersona(personaId) {
    const persona = this._ownPersonaList.find((p) => p.id === personaId);
    return new Promise(
      (resolve) => this.setupPersonaSession(personaId, resolve, persona?.firstName, persona?.lastName)
    );
  }
  /**
   * Close the active PersonaSession and the RUser model.
   */
  async disconnect() {
    this._friendsService = null;
    if (this._personaSession) {
      await this._personaSession.disconnect();
      this._personaSession = null;
    }
    if (this.pRUser) {
      this.pRUser.Detach(this);
    }
    this._ownPersonaList = [];
    this.setState("Disconnected" /* Disconnected */);
  }
  /**
   * Relay a teleport command to the active PersonaSession.
   */
  teleportTo(celestialId, position) {
    if (!this._personaSession) {
      console.error("[UserSession] No PersonaSession for teleport");
      return;
    }
    this._personaSession.teleportTo(celestialId, position);
  }
  /** Returns the active PersonaSession, or `null` before `pickPersona()` is called. */
  get personaSession() {
    return this._personaSession;
  }
  /**
   * Set up a PersonaSession for the given persona ID,
   * then resolve the enclosing promise once the session is connected.
   */
  setupPersonaSession(id, resolve, firstName, lastName) {
    this._personaSession = new PersonaSession(id, this.pLnG, this.pRUser, firstName, lastName, this._loginClient);
    void this._personaSession.connect().then(() => {
      this._initFriendsService();
      resolve();
    }).catch((err) => {
      console.error("[UserSession] PersonaSession.connect failed:", err);
      throw err;
    });
  }
  /**
   * Initialize the friends service via pFabric.GetLnG("friends").
   * Uses the Attach/onReadyState event pattern to wait for readiness.
   */
  _initFriendsService() {
    const pFabric2 = getPFabric();
    if (!pFabric2) return;
    const friendsLnG = pFabric2.GetLnG("friends");
    if (!friendsLnG) return;
    if (friendsLnG.IsReady()) {
      this._friendsService = friendsLnG;
      return;
    }
    const listener = {
      onReadyState: () => {
        if (friendsLnG.IsReady()) {
          pFabric2.Detach(listener);
          this._friendsService = friendsLnG;
        }
      }
    };
    pFabric2.Attach(listener);
  }
};

// src/client/LoginClient.ts
var PERSONA_ENUM_WAIT_MS = 500;
var LoginClient = class {
  constructor(_container) {
    this.userSession = null;
    this.pendingUser = null;
    this.avatarUpdateActive = false;
    // ─── 2FA ───────────────────────────────────────────────────────────────────
    this.pendingTfaResolve = null;
    this._pLnG = createLnGClient();
    this.bindUI();
  }
  // ─── Public getters ────────────────────────────────────────────────────────
  /**
   * Public accessor for pLnG instance.
   * Required by UserSession and PersonaSession constructors.
   */
  get pLnG() {
    return this._pLnG;
  }
  /**
   * Returns the active UserSession once authenticated, or `null` before login.
   * Use `userSession.personaSession?.inWorld?.audio` to reach the audio manager.
   */
  get session() {
    return this.userSession;
  }
  // ─── UI helpers ────────────────────────────────────────────────────────────
  el(id) {
    return document.getElementById(id);
  }
  showRoute(id) {
    const routes = [
      "not-logged-in-route",
      "guest-sign-in-route",
      "login-route",
      "persona-picker-route",
      "tfa-route"
    ];
    for (const r of routes) {
      const el = this.el(r);
      if (el) el.classList.toggle("d-none", r !== id);
    }
  }
  showSection(section) {
    const loginSection = this.el("login-section");
    const sessionSection = this.el("session-section");
    if (loginSection) loginSection.classList.toggle("d-none", section !== "login");
    if (sessionSection) sessionSection.classList.toggle("d-none", section !== "session");
  }
  updateStatusBadge(type) {
    const badge = document.querySelector("#status-panel .status-badge");
    if (!badge) return;
    badge.className = `status-badge ${type}`;
    const labels = {
      pending: "Pending",
      success: "Connected",
      error: "Error",
      "logged-in": "Logged In",
      "refresh-required": "REFRESH REQUIRED"
    };
    badge.textContent = labels[type] ?? type;
  }
  appendStatus(message) {
    const content = this.el("status-content");
    if (!content) return;
    const line = document.createElement("div");
    const now = (/* @__PURE__ */ new Date()).toLocaleTimeString();
    line.textContent = `[${now}] ${message}`;
    content.appendChild(line);
    content.scrollTop = content.scrollHeight;
  }
  updateSessionInfo() {
    const info = this.el("session-info");
    if (!info || !this.userSession) return;
    const session = this.userSession;
    info.innerHTML = `<pre>${JSON.stringify(
      {
        userId: session.userId,
        displayName: session.username,
        personas: session.ownPersonaList.map((p) => ({ id: p.id, name: p.displayName })),
        connectionState: session.state
      },
      null,
      2
    )}</pre>`;
  }
  // ─── Persona picker ────────────────────────────────────────────────────────
  /**
   * Auto-pick the first persona without showing the picker UI.
   */
  showPersonaPicker(user) {
    this.pendingUser = user;
    if (user.personas.length > 0) {
      this.appendStatus(`Auto-picking persona "${user.personas[0].displayName}".`);
      void this.onPersonaPicked(user.personas[0].id).catch((err) => {
        this.updateStatusBadge("error");
        this.appendStatus(`Persona error: ${err.message}`);
      });
    } else {
      this.appendStatus("No personas found. Create a new persona to continue.");
      this.showRoute("persona-picker-route");
    }
  }
  async onPersonaPicked(personaId) {
    if (!this.pendingUser) return;
    const user = this.pendingUser;
    this.pendingUser = null;
    this.userSession = new UserSession(user, this);
    await this.userSession.connect();
    this.appendStatus(`Entering world with persona ${personaId}\u2026`);
    try {
      await this.userSession.pickPersona(personaId);
      this.onSessionStarted();
    } catch (err) {
      this.updateStatusBadge("error");
      this.appendStatus(`Persona error: ${err.message}`);
    }
  }
  onSessionStarted() {
    if (!this.userSession) return;
    const displayNameEl = this.el("user-display-name");
    if (displayNameEl) displayNameEl.textContent = this.userSession.username;
    this.showSection("session");
    this.updateStatusBadge("logged-in");
    this.updateSessionInfo();
    this.appendStatus(
      `Session started as "${this.userSession.username}" (${this.userSession.userId})`
    );
  }
  // ─── Event binding ─────────────────────────────────────────────────────────
  bindUI() {
    this.el("login-guest-button")?.addEventListener("click", () => {
      this.showRoute("guest-sign-in-route");
    });
    this.el("login-or-create-button")?.addEventListener("click", () => {
      this.showRoute("login-route");
    });
    this.el("guest-cancel-button")?.addEventListener("click", () => {
      this.showRoute("not-logged-in-route");
    });
    this.el("login-back-button")?.addEventListener("click", () => {
      this.showRoute("not-logged-in-route");
    });
    this.el("guest-form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      void this.handleGuestLogin();
    });
    this.el("login-form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const email = (this.el("login-email")?.value ?? "").trim();
      const password = this.el("login-password")?.value ?? "";
      const remember = this.el("login-remember")?.checked ?? false;
      if (!email || !password) return;
      void this.handleMemberLogin({ email, password, remember });
    });
    this.el("vis-login-password")?.addEventListener("click", () => {
      const pw = this.el("login-password");
      if (!pw) return;
      pw.type = pw.type === "password" ? "text" : "password";
    });
    this.el("create-persona-button")?.addEventListener("click", () => {
      void this.handleCreatePersona();
    });
    this.el("tfa-form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const code = (this.el("tfa-code")?.value ?? "").trim();
      if (!code) return;
      this.submitTfaCode(code);
    });
    this.el("logout-button-main")?.addEventListener("click", () => {
      void this.handleLogout();
    });
    this.el("teleport-now-button")?.addEventListener("click", () => {
      this.handleTeleport();
    });
    this.el("teleport-button")?.addEventListener("click", () => {
      this.handleAvatarUpdateToggle();
    });
    this.el("lat-decr")?.addEventListener("click", () => {
      this.adjustLatLon("teleport-latitude", -1e-4);
    });
    this.el("lat-incr")?.addEventListener("click", () => {
      this.adjustLatLon("teleport-latitude", 1e-4);
    });
    this.el("lon-decr")?.addEventListener("click", () => {
      this.adjustLatLon("teleport-longitude", -1e-4);
    });
    this.el("lon-incr")?.addEventListener("click", () => {
      this.adjustLatLon("teleport-longitude", 1e-4);
    });
    this.el("radius-decr")?.addEventListener("click", () => {
      this.adjustLatLon("teleport-radius", -1);
    });
    this.el("radius-incr")?.addEventListener("click", () => {
      this.adjustLatLon("teleport-radius", 1);
    });
    document.querySelectorAll(".location-preset").forEach((btn) => {
      btn.addEventListener("click", () => {
        const celestial = btn.dataset["celestial"] ?? "";
        const lat = btn.dataset["lat"] ?? "0";
        const lon = btn.dataset["lon"] ?? "0";
        const radius = btn.dataset["radius"] ?? "6371000";
        this.setTeleportInputs(celestial, lat, lon, radius);
        this.handleTeleport();
      });
    });
    this.el("clear-status-btn")?.addEventListener("click", () => {
      const content = this.el("status-content");
      if (content) content.innerHTML = "";
    });
  }
  // ─── Auth handlers ─────────────────────────────────────────────────────────
  /**
   * Member login — calls pLnG.Login(MV.MVMF.Encode({ contact, password, remember }), finalizationHandler).
   * MV LnG handles all HTTP communication with RP1 servers internally.
   */
  async handleMemberLogin(credentials) {
    const btn = this.el("login-button");
    if (btn) btn.disabled = true;
    this.updateStatusBadge("pending");
    this.appendStatus("Connecting to RP1 via MV LnG\u2026");
    try {
      const encoded = MV.MVMF.Encode({ contact: credentials.email, password: credentials.password, remember: credentials.remember });
      const user = await this._pLnG.Login(
        encoded,
        (resolve2FA) => {
          this.appendStatus("2FA required \u2014 enter confirmation code.");
          this.showTfaRoute(resolve2FA);
        }
      );
      this.updateStatusBadge("success");
      this.pendingUser = user;
      this.userSession = new UserSession(user, this);
      await this.userSession.connect();
      await new Promise((resolve) => setTimeout(resolve, PERSONA_ENUM_WAIT_MS));
      const personas = this.userSession.ownPersonaList;
      if (personas.length > 0) {
        this.appendStatus(`Auto-picking persona "${personas[0].displayName}".`);
        try {
          await this.userSession.pickPersona(personas[0].id);
          this.onSessionStarted();
        } catch (err) {
          this.updateStatusBadge("error");
          this.appendStatus(`Persona error: ${err.message}`);
        }
      } else {
        this.appendStatus("No personas found. Create a new persona to continue.");
        this.showRoute("persona-picker-route");
      }
    } catch (err) {
      this.updateStatusBadge("error");
      this.appendStatus(`Login error: ${err.message}`);
    } finally {
      if (btn) btn.disabled = false;
    }
  }
  /**
   * Guest login — calls pLnG.Login(MV.MVMF.Encode({ contact: GUEST_EMAIL, password: GUEST_EMAIL })).
   * MV LnG requires both contact and password fields to initiate an anonymous session.
   * Guests skip RPERSONA_OPEN and go directly to RPERSONA_ENTER via pickPersona().
   */
  async handleGuestLogin() {
    const btn = this.el("guest-join-button");
    if (btn) btn.disabled = true;
    this.updateStatusBadge("pending");
    this.appendStatus("Connecting to RP1 as guest via MV LnG\u2026");
    try {
      const user = await this._pLnG.Login(MV.MVMF.Encode({ contact: GUEST_EMAIL, password: GUEST_EMAIL }));
      this.appendStatus(`Guest session started.`);
      this.updateStatusBadge("success");
      this.userSession = new UserSession(user);
      await this.userSession.connect();
      await new Promise((resolve) => setTimeout(resolve, PERSONA_ENUM_WAIT_MS));
      const personaId = this.userSession.ownPersonaList[0]?.id ?? "0";
      this.appendStatus(`Opening persona ${personaId}\u2026`);
      await this.userSession.pickPersona(personaId);
      this.onSessionStarted();
    } catch (err) {
      this.updateStatusBadge("error");
      this.appendStatus(`Guest login error: ${err.message}`);
      if (this.userSession) {
        await this.userSession.disconnect();
        this.userSession = null;
      }
    } finally {
      if (btn) btn.disabled = false;
    }
  }
  async handleCreatePersona() {
    if (!this.pendingUser) return;
    const user = this.pendingUser;
    this.userSession = new UserSession(user);
    await this.userSession.connect();
    this.appendStatus(`Opening persona\u2026`);
    try {
      await this.userSession.pickPersona("0");
      this.onSessionStarted();
    } catch (err) {
      this.updateStatusBadge("error");
      this.appendStatus(`Open persona error: ${err.message}`);
    }
  }
  async handleLogout() {
    this.avatarUpdateActive = false;
    const btn = this.el("teleport-button");
    if (btn) {
      btn.innerHTML = '<i class="fa-solid fa-satellite-dish"></i> Start Avatar Updates';
      btn.classList.remove("active");
    }
    await this._pLnG.Logout();
    if (this.userSession) {
      await this.userSession.disconnect();
      this.userSession = null;
    }
    this.pendingUser = null;
    this.showSection("login");
    this.showRoute("not-logged-in-route");
    this.updateStatusBadge("pending");
    this.appendStatus("Logged out.");
  }
  showTfaRoute(resolve2FA) {
    this.pendingTfaResolve = resolve2FA;
    const codeInput = this.el("tfa-code");
    if (codeInput) codeInput.value = "";
    this.showRoute("tfa-route");
  }
  submitTfaCode(code) {
    if (!this.pendingTfaResolve) return;
    const resolve = this.pendingTfaResolve;
    this.pendingTfaResolve = null;
    this.appendStatus("Submitting 2FA code\u2026");
    resolve(code);
  }
  // ─── Teleport ──────────────────────────────────────────────────────────────
  adjustLatLon(inputId, delta) {
    const input = this.el(inputId);
    if (!input) return;
    const current = parseFloat(input.value) || 0;
    input.value = (current + delta).toFixed(4);
  }
  handleAvatarUpdateToggle() {
    this.avatarUpdateActive = !this.avatarUpdateActive;
    const btn = this.el("teleport-button");
    if (this.avatarUpdateActive) {
      if (btn) {
        btn.innerHTML = '<i class="fa-solid fa-satellite-dish"></i> Avatar Updates Sending Active';
        btn.classList.add("active");
      }
      console.log("[LoginClient] Registering avatar update callback (pTime-driven)");
      this.userSession?.personaSession?.setAvatarUpdateCallback(() => {
        try {
          this.sendAvatarUpdate();
        } catch (err) {
          console.error("[LoginClient] sendAvatarUpdate error:", err);
        }
      });
    } else {
      if (btn) {
        btn.innerHTML = '<i class="fa-solid fa-satellite-dish"></i> Start Avatar Updates';
        btn.classList.remove("active");
      }
      console.log("[LoginClient] Clearing avatar update callback");
      this.userSession?.personaSession?.setAvatarUpdateCallback(null);
    }
  }
  sendAvatarUpdate() {
    const celestial = (this.el("celestial-id")?.value ?? "").trim();
    const lat = parseFloat(
      this.el("teleport-latitude")?.value ?? "0"
    );
    const lon = parseFloat(
      this.el("teleport-longitude")?.value ?? "0"
    );
    const radius = parseFloat(
      this.el("teleport-radius")?.value ?? "0"
    );
    if (!celestial || isNaN(lat) || isNaN(lon) || isNaN(radius)) return;
    const [dx, dy, dz] = latLonToCartesianYUp(lat, lon, radius);
    this.userSession?.teleportTo(celestial, { x: dx, y: dy, z: dz });
  }
  setTeleportInputs(celestial, lat, lon, radius) {
    const set = (id, val) => {
      const el = this.el(id);
      if (el) el.value = val;
    };
    set("celestial-id", celestial);
    set("teleport-latitude", lat);
    set("teleport-longitude", lon);
    set("teleport-radius", radius);
  }
  handleTeleport() {
    const celestial = (this.el("celestial-id")?.value ?? "").trim();
    const lat = parseFloat(
      this.el("teleport-latitude")?.value ?? "0"
    );
    const lon = parseFloat(
      this.el("teleport-longitude")?.value ?? "0"
    );
    const radius = parseFloat(
      this.el("teleport-radius")?.value ?? "0"
    );
    if (!celestial || isNaN(lat) || isNaN(lon) || isNaN(radius)) {
      this.appendStatus("Teleport: invalid coordinates.");
      return;
    }
    const [dx, dy, dz] = latLonToCartesianYUp(lat, lon, radius);
    const fmt = (n) => n.toFixed(2);
    const elDx = this.el("coord-dx");
    const elDy = this.el("coord-dy");
    const elDz = this.el("coord-dz");
    if (elDx) elDx.textContent = fmt(dx);
    if (elDy) elDy.textContent = fmt(dy);
    if (elDz) elDz.textContent = fmt(dz);
    const elCelestial = this.el("current-celestial");
    const elPosition = this.el("current-position");
    if (elCelestial) elCelestial.textContent = celestial;
    if (elPosition) {
      elPosition.textContent = `${Math.abs(lat).toFixed(4)}\xB0${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(4)}\xB0${lon >= 0 ? "E" : "W"}, ${radius}m`;
    }
    this.userSession?.teleportTo(celestial, { x: dx, y: dy, z: dz });
    this.appendStatus(
      `Teleport \u2192 ${celestial} lat=${lat} lon=${lon} radius=${radius}m`
    );
    this.updateSessionInfo();
  }
};
function latLonToCartesianYUp(latDeg, lonDeg, radius) {
  const lat = latDeg * Math.PI / 180;
  const lon = lonDeg * Math.PI / 180;
  const cosLat = Math.cos(lat);
  const x = radius * cosLat * Math.sin(lon);
  const y = radius * Math.sin(lat);
  const z = radius * cosLat * Math.cos(lon);
  return [x, y, z];
}
export {
  AudioFrameBuffer,
  AudioFrameCapture,
  AudioVisualizer,
  LoginClient
};
//# sourceMappingURL=app.js.map
