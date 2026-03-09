/**
 * PersonaInfoCache – fetches and caches external avatar display names.
 *
 * The Avatar Open packet only contains the persona ID (8 bytes), not the
 * name metadata. This cache queries RPersona_Cache via pLnG.GetLnG() and
 * batches all fetch requests within a 500 ms window to avoid server spam.
 *
 * Usage:
 *   const cache = new PersonaInfoCache(pLnG);
 *   cache.requestName(personaId, (name) => updateAvatarLabel(name));
 *   cache.dispose();  // cancel pending timers on logout
 */
export class PersonaInfoCache {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly pLnG: any;

  /** Resolved names keyed by numeric persona ID. */
  private readonly nameCache: Map<number, string> = new Map();

  /** IDs queued for the next batch fetch. */
  private readonly pendingIds: Set<number> = new Set();

  /** Callbacks awaiting resolution, keyed by persona ID. */
  private readonly pendingCallbacks: Map<number, Set<(name: string) => void>> = new Map();

  /** Handle for the scheduled batch flush. */
  private batchTimer: ReturnType<typeof setTimeout> | null = null;

  private static readonly BATCH_DELAY_MS = 500;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(pLnG: any) {
    this.pLnG = pLnG;
  }

  /**
   * Request the display name for a persona ID.
   *
   * If the name is already in the local cache, the callback is invoked
   * synchronously. Otherwise it is queued for the next batch fetch
   * (fired at most 500 ms later) and the callback is stored until
   * the server responds.
   *
   * @param personaId  Numeric persona ID from the Avatar Open packet.
   * @param callback   Invoked with the resolved display name.
   */
  requestName(personaId: number, callback: (name: string) => void): void {
    const cached = this.nameCache.get(personaId);
    if (cached !== undefined) {
      callback(cached);
      return;
    }

    if (!this.pendingCallbacks.has(personaId)) {
      this.pendingCallbacks.set(personaId, new Set());
    }
    this.pendingCallbacks.get(personaId)!.add(callback);
    this.pendingIds.add(personaId);

    if (this.batchTimer === null) {
      this.batchTimer = setTimeout(
        () => { void this.flushBatch(); },
        PersonaInfoCache.BATCH_DELAY_MS
      );
    }
  }

  /**
   * Return a synchronously cached name, or `null` if not yet resolved.
   */
  getCachedName(personaId: number): string | null {
    return this.nameCache.get(personaId) ?? null;
  }

  /**
   * Flush the pending batch: open RPersona_Cache models for each queued ID,
   * read the display name, cache it, then fire all waiting callbacks.
   */
  private async flushBatch(): Promise<void> {
    this.batchTimer = null;

    if (this.pendingIds.size === 0) return;

    const ids = Array.from(this.pendingIds);
    this.pendingIds.clear();

    let pPersonaCache: unknown;
    try {
      pPersonaCache = this.pLnG.GetLnG('rp1_persona_cache');
    } catch (err) {
      console.warn('[PersonaInfoCache] Failed to obtain rp1_persona_cache from pLnG:', err);
      return;
    }

    if (!pPersonaCache) {
      console.warn('[PersonaInfoCache] rp1_persona_cache is not available from pLnG');
      return;
    }

    for (const id of ids) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pModel = (pPersonaCache as any).Model_Open('RPersona_Cache', id);
        if (pModel) {
          const forename: string = pModel.Name?.wszForename ?? '';
          const surname: string = pModel.Name?.wszSurname ?? '';
          const name = `${forename} ${surname}`.trim() || `Avatar ${id}`;
          this.nameCache.set(id, name);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (pPersonaCache as any).Model_Close(pModel);
          this.notifyCallbacks(id, name);
        }
      } catch (err) {
        console.warn(`[PersonaInfoCache] Failed to fetch name for persona ${id}:`, err);
      }
    }
  }

  private notifyCallbacks(personaId: number, name: string): void {
    const callbacks = this.pendingCallbacks.get(personaId);
    if (!callbacks) return;
    for (const cb of callbacks) {
      try {
        cb(name);
      } catch (err) {
        console.error('[PersonaInfoCache] Callback error for persona', personaId, ':', err);
      }
    }
    this.pendingCallbacks.delete(personaId);
  }

  /**
   * Cancel pending batch timers and clear all caches.
   * Must be called on logout / session teardown to avoid stale data.
   */
  dispose(): void {
    if (this.batchTimer !== null) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    this.nameCache.clear();
    this.pendingIds.clear();
    this.pendingCallbacks.clear();
    console.log('[PersonaInfoCache] Disposed');
  }
}
