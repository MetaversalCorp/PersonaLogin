/**
 * Avatar info with calculated distance for sorting and display.
 */
export interface AvatarInfo {
  personaID: number;
  name: string;
  position: { x: number; y: number; z: number };
  distance: number;
}

/**
 * Tracks nearby external avatars by intercepting Proximity's internal
 * avatar event notifications. This follows the pattern from PersonaLogin's
 * audio decode interception system.
 *
 * When initialized with a Proximity instance, wraps its internal notification
 * methods to intercept onModelUpdate, onModelClose, etc. events.
 */
export class ProximityAvatarList {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private proximity: any = null;
  private avatars: Map<number, AvatarInfo> = new Map();
  private localPosition: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 };
  private localPersonaID: number | null = null;
  private observers: Set<(avatars: AvatarInfo[]) => void> = new Set();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private originalNotify: any = null;
  private notifyMethodName: string = '';

  /**
   * Initialize and hook into the Proximity instance.
   * Wraps Proximity's notification mechanism to intercept avatar events.
   *
   * @param proximity The MV.MVRP.Proximity instance from ProximityAudioManager
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  init(proximity: any): void {
    if (!proximity) {
      console.warn('[ProximityAvatarList] Proximity instance is null');
      return;
    }

    this.proximity = proximity;

    // Hook into Proximity's notification system by wrapping its internal
    // dispatch method – the same technique used by the audio decode interceptor.
    this.setupProximityInterception();

    console.log('[ProximityAvatarList] Initialized and hooked into Proximity');
  }

  /**
   * Intercept Proximity's notification/dispatch mechanism.
   * Similar to setupDecodeInterception in ProximityAudioManager.
   */
  private setupProximityInterception(): void {
    if (!this.proximity) return;

    // Proximity may dispatch events through one of these methods
    const notifyMethods = ['Emit', 'Notify', 'NotifyListeners', 'notify'];
    let foundMethod = null;
    let methodName = '';

    for (const method of notifyMethods) {
      if (typeof this.proximity[method] === 'function') {
        foundMethod = this.proximity[method];
        methodName = method;
        break;
      }
    }

    if (!foundMethod) {
      console.warn('[ProximityAvatarList] Could not find Proximity notification method; falling back to Attach');
      // Fall back to direct attachment
      if (typeof this.proximity.Attach === 'function') {
        try {
          this.proximity.Attach(this);
          console.log('[ProximityAvatarList] Attached as listener (fallback)');
        } catch (err) {
          console.error('[ProximityAvatarList] Failed to attach:', err);
        }
      }
      return;
    }

    // Capture method name and original for later restoration in dispose()
    this.originalNotify = foundMethod;
    this.notifyMethodName = methodName;

    // Wrap the notification method to intercept events and forward to our handlers.
    // Arrow function preserves `this` as the ProximityAvatarList instance;
    // the original method is called with the proximity object as context.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.proximity[methodName] = (eventName: string, ...args: any[]): any => {
      // Call the original dispatch first so existing listeners are unaffected
      const result = this.originalNotify.call(this.proximity, eventName, ...args);

      // Intercept avatar events and forward to our handlers
      if (eventName === 'onModelUpdate' && args.length >= 2) {
        const [SBA_RProximity_Avatar_Open_Ex, dwRPersonaIx, MVO_RAvatar_State] = args;
        this.onModelUpdate(SBA_RProximity_Avatar_Open_Ex, dwRPersonaIx, MVO_RAvatar_State);
      } else if (eventName === 'onModelClose' && args.length >= 1) {
        const [dwRPersonaIx] = args;
        this.onModelClose(dwRPersonaIx);
      } else if (eventName === 'onModelHide' && args.length >= 1) {
        const [dwRPersonaIx] = args;
        this.onModelHide(dwRPersonaIx);
      } else if (eventName === 'onUserReady' && args.length >= 5) {
        const [nAvatarIx, dwRPersonaIx, nX, nY, nZ] = args;
        this.onUserReady(nAvatarIx, dwRPersonaIx, nX, nY, nZ);
      } else if (eventName === 'onLogout_Client' && args.length >= 1) {
        const [bVoluntary] = args;
        this.onLogout_Client(bVoluntary);
      } else if (eventName === 'onTime_Tick') {
        this.onTime_Tick(args[0]);
      }

      return result;
    };

    console.log('[ProximityAvatarList] Wrapped Proximity.' + methodName + ' for event interception');
  }

  /**
   * Avatar event callback: Local avatar has entered the world.
   */
  onUserReady(nAvatarIx: number, dwRPersonaIx: number, nX: number, nY: number, nZ: number): void {
    this.localPersonaID = dwRPersonaIx;
    this.localPosition = { x: nX, y: nY, z: nZ };
    console.log('[ProximityAvatarList] onUserReady: Local avatar', dwRPersonaIx, 'at', nX, nY, nZ);
  }

  /**
   * Avatar event callback: External avatar has appeared or updated.
   * Called when Proximity has avatar update data.
   *
   * @param SBA_RProximity_Avatar_Open_Ex Avatar metadata (null on updates, present on first appearance)
   * @param dwRPersonaIx The unique ID of the external avatar
   * @param MVO_RAvatar_State Avatar state including position, rotation, animation
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onModelUpdate(SBA_RProximity_Avatar_Open_Ex: any, dwRPersonaIx: number, MVO_RAvatar_State: any): void {
    // Skip the local avatar
    if (dwRPersonaIx === this.localPersonaID) {
      return;
    }

    console.log('[ProximityAvatarList] onModelUpdate:', dwRPersonaIx, 'isNew:', !!SBA_RProximity_Avatar_Open_Ex);

    // Extract name from avatar open data (only present on first appearance)
    let name = 'Unknown';
    if (SBA_RProximity_Avatar_Open_Ex) {
      const forename = SBA_RProximity_Avatar_Open_Ex.Name?.wszForename ?? '';
      const surname = SBA_RProximity_Avatar_Open_Ex.Name?.wszSurname ?? '';
      name = `${forename} ${surname}`.trim() || `Avatar ${dwRPersonaIx}`;
    } else {
      // On update, preserve existing name
      const existing = this.avatars.get(dwRPersonaIx);
      if (existing) {
        name = existing.name;
      }
    }

    // Get position from avatar state (vHead is used in clientBridge.js comments)
    const position = MVO_RAvatar_State?.MVO_RPosition_Head;
    if (position) {
      const distance = this.calculateDistance(position);
      this.avatars.set(dwRPersonaIx, {
        personaID: dwRPersonaIx,
        name,
        position: { x: position.nX, y: position.nY, z: position.nZ },
        distance,
      });
      console.log('[ProximityAvatarList] Avatar updated:', dwRPersonaIx, name, distance.toFixed(2) + 'm');
      this.notifyObservers();
    }
  }

  /**
   * Proximity callback: External avatar has been removed from the world.
   * Called by Proximity when avatar leaves proximity/world.
   */
  onModelClose(dwRPersonaIx: number): void {
    // Skip the local avatar
    if (dwRPersonaIx === this.localPersonaID) {
      return;
    }

    console.log('[ProximityAvatarList] onModelClose:', dwRPersonaIx);

    if (this.avatars.has(dwRPersonaIx)) {
      this.avatars.delete(dwRPersonaIx);
      this.notifyObservers();
    }
  }

  /**
   * Avatar event callback: External avatar has gone out of range (hidden).
   */
  onModelHide(dwRPersonaIx: number): void {
    // Skip the local avatar
    if (dwRPersonaIx === this.localPersonaID) {
      return;
    }

    console.log('[ProximityAvatarList] onModelHide:', dwRPersonaIx);

    if (this.avatars.has(dwRPersonaIx)) {
      this.avatars.delete(dwRPersonaIx);
      this.notifyObservers();
    }
  }

  /**
   * Avatar event callback: User has logged out.
   * Clear all tracked avatars.
   */
  onLogout_Client(bVoluntary: boolean): void {
    console.log('[ProximityAvatarList] onLogout_Client:', bVoluntary);
    this.avatars.clear();
    this.localPersonaID = null;
    this.notifyObservers();
  }

  /**
   * Tick callback: Time tick update.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onTime_Tick(_pParam: any): void {
    // Tick received, can be used for periodic recalculations if needed
  }

  /**
   * Calculate Euclidean distance from local avatar to remote avatar.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private calculateDistance(position: any): number {
    const dx = position.nX - this.localPosition.x;
    const dy = position.nY - this.localPosition.y;
    const dz = position.nZ - this.localPosition.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  /**
   * Get the 5 closest avatars, sorted by distance.
   */
  getClosestAvatars(count: number = 5): AvatarInfo[] {
    return Array.from(this.avatars.values())
      .sort((a, b) => a.distance - b.distance)
      .slice(0, count);
  }

  /**
   * Register an observer to be notified when the avatar list changes.
   */
  addObserver(callback: (avatars: AvatarInfo[]) => void): void {
    this.observers.add(callback);
  }

  /**
   * Remove an observer.
   */
  removeObserver(callback: (avatars: AvatarInfo[]) => void): void {
    this.observers.delete(callback);
  }

  /**
   * Notify all observers of avatar list changes.
   */
  private notifyObservers(): void {
    const closestAvatars = this.getClosestAvatars(5);
    for (const observer of this.observers) {
      observer(closestAvatars);
    }
  }

  /**
   * Clean up: Restore the original Proximity notification method and release resources.
   */
  dispose(): void {
    this.avatars.clear();
    this.observers.clear();

    if (this.proximity && this.originalNotify && this.notifyMethodName) {
      try {
        // Restore the original notification method
        this.proximity[this.notifyMethodName] = this.originalNotify;
        console.log('[ProximityAvatarList] Restored original Proximity.' + this.notifyMethodName);
      } catch (err) {
        console.error('[ProximityAvatarList] Error during cleanup:', err);
      }
    } else if (this.proximity && !this.originalNotify) {
      // Attached via Attach fallback – detach
      try {
        if (typeof this.proximity.Detach === 'function') {
          this.proximity.Detach(this);
          console.log('[ProximityAvatarList] Detached from Proximity (fallback)');
        }
      } catch (err) {
        console.error('[ProximityAvatarList] Error detaching:', err);
      }
    }
    this.proximity = null;
    this.originalNotify = null;
    this.notifyMethodName = '';
  }
}
