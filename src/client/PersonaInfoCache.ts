import { getPFabric } from '../mv/LnG.js';

/**
 * Fetches avatar display names from the RPersona_Cache service.
 *
 * Uses `getPFabric().GetLnG('persona_cache')` to open a **separate** LnG
 * for the persona cache service (distinct from the main login LnG), then
 * opens the `RPersona_Cache` model on that service LnG.
 *
 * Incoming `requestName()` calls are batched for ~500 ms and resolved in a
 * single `RPersona_Cache.Fetch()` call, keeping network chatter low even
 * when many avatars enter proximity simultaneously.
 */
export class PersonaInfoCache {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private cacheLnG: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private personaCache: any = null;

  /** Resolved names keyed by numeric persona ID. */
  private readonly nameCache: Map<number, string> = new Map();

  /** Callbacks waiting for a name, keyed by numeric persona ID. */
  private readonly pendingCallbacks: Map<number, Array<(name: string) => void>> = new Map();

  /** Persona IDs queued for the next batched Fetch call. */
  private fetchQueue: Set<number> = new Set();

  /** Timer handle for the batched fetch. */
  private batchTimer: ReturnType<typeof setTimeout> | null = null;

  /** How long (ms) to accumulate IDs before issuing a Fetch call. */
  private static readonly BATCH_DELAY_MS = 500;

  constructor() {
    try {
      const pFabric = getPFabric();
      if (!pFabric) {
        console.warn('[PersonaInfoCache] pFabric not available; names will not be fetched');
        return;
      }

      // Open a separate LnG for the persona_cache service.
      // This is the correct pattern: GetLnG() is on pFabric, NOT on pLnG.
      this.cacheLnG = pFabric.GetLnG('persona_cache');
      if (!this.cacheLnG) {
        console.warn('[PersonaInfoCache] GetLnG("persona_cache") returned null');
        return;
      }

      // Open the RPersona_Cache model on the service LnG.
      this.personaCache = this.cacheLnG.Model_Open('RPersona_Cache');
      if (!this.personaCache) {
        console.warn('[PersonaInfoCache] Model_Open("RPersona_Cache") returned null');
        return;
      }

      console.log('[PersonaInfoCache] Initialized — RPersona_Cache model ready');
    } catch (err) {
      console.error('[PersonaInfoCache] Error during initialization:', err);
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
  requestName(personaID: number, callback: (name: string) => void): void {
    // Return cached name immediately if available.
    const cached = this.nameCache.get(personaID);
    if (cached !== undefined) {
      callback(cached);
      return;
    }

    // Queue the callback.
    const existing = this.pendingCallbacks.get(personaID);
    if (existing) {
      existing.push(callback);
    } else {
      this.pendingCallbacks.set(personaID, [callback]);
    }

    this.fetchQueue.add(personaID);

    // Arm the batch timer if not already running.
    if (this.batchTimer === null) {
      this.batchTimer = setTimeout(() => this.flushFetchQueue(), PersonaInfoCache.BATCH_DELAY_MS);
    }
  }

  /**
   * Flush the queued persona IDs with a single `RPersona_Cache.Fetch()` call.
   */
  private flushFetchQueue(): void {
    this.batchTimer = null;

    if (!this.personaCache || this.fetchQueue.size === 0) {
      return;
    }

    const ids = Array.from(this.fetchQueue);
    this.fetchQueue = new Set();

    console.log('[PersonaInfoCache] Fetching names for persona IDs:', ids);

    try {
      // The second argument is the caller-context object passed back to the
      // callback by the RPersona_Cache Fetch API (legacy MV calling convention).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.personaCache.Fetch(ids, this, (response: Record<string, Record<string, unknown>>) => {
        this.handleFetchResponse(response, ids);
      });
    } catch (err) {
      console.error('[PersonaInfoCache] Fetch error:', err);
      // Invoke callbacks with fallback names so the UI is not left waiting.
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
  private handleFetchResponse(response: Record<string, Record<string, unknown>>, requestedIds: number[]): void {
    if (!response || typeof response !== 'object') {
      console.warn('[PersonaInfoCache] Unexpected Fetch response:', response);
      // Fall back for all requested IDs.
      for (const id of requestedIds) {
        this.resolveName(id, `Avatar ${id}`);
      }
      return;
    }

    const resolved = new Set<number>();

    for (const [key, data] of Object.entries(response)) {
      const personaID = Number(key);
      if (isNaN(personaID)) continue;

      const forename = typeof data?.Name_wsForename === 'string' ? data.Name_wsForename : '';
      const surname = typeof data?.Name_wsSurname === 'string' ? data.Name_wsSurname : '';
      const displayName = [forename, surname].filter(Boolean).join(' ') || `Avatar ${personaID}`;

      this.resolveName(personaID, displayName);
      resolved.add(personaID);
    }

    // Apply fallback only for IDs from this specific Fetch that were not in
    // the response.  Do NOT iterate all pendingCallbacks — some may belong to
    // a later batch that is still in flight.
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
  private resolveName(personaID: number, name: string): void {
    this.nameCache.set(personaID, name);
    const callbacks = this.pendingCallbacks.get(personaID);
    if (callbacks) {
      this.pendingCallbacks.delete(personaID);
      for (const cb of callbacks) {
        try {
          cb(name);
        } catch (err) {
          console.error('[PersonaInfoCache] Callback error for persona', personaID, err);
        }
      }
    }
  }

  /**
   * Release the RPersona_Cache model and cancel any pending timer.
   */
  dispose(): void {
    if (this.batchTimer !== null) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    // Resolve any still-pending callbacks with fallback names.
    for (const [id, callbacks] of this.pendingCallbacks) {
      for (const cb of callbacks) {
        try {
          cb(`Avatar ${id}`);
        } catch (_) {
          // ignore
        }
      }
    }
    this.pendingCallbacks.clear();
    this.fetchQueue.clear();

    if (this.personaCache && this.cacheLnG) {
      try {
        this.cacheLnG.Model_Close(this.personaCache);
      } catch (err) {
        console.error('[PersonaInfoCache] Error closing model:', err);
      }
      this.personaCache = null;
    }

    this.cacheLnG = null;
    this.nameCache.clear();
    console.log('[PersonaInfoCache] Disposed');
  }
}
