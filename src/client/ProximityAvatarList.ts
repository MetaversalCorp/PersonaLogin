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
 * Tracks nearby external avatars by listening to Proximity events.
 * Attaches directly to the Proximity instance using Proximity.Attach(this).
 * Implements the callback interface that Proximity will invoke.
 */
export class ProximityAvatarList {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private proximity: any = null;
  private avatars: Map<number, AvatarInfo> = new Map();
  private localPosition: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 };
  private localPersonaID: number | null = null;
  private observers: Set<(avatars: AvatarInfo[]) => void> = new Set();

  /**
   * Initialize and attach to the Proximity instance.
   * @param proximity The Proximity instance from ProximityAudioManager
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  init(proximity: any): void {
    if (!proximity) {
      console.warn('[ProximityAvatarList] Proximity instance is null');
      return;
    }

    this.proximity = proximity;

    // Attach this listener to Proximity
    // Proximity will call our callback methods when avatar events occur
    try {
      this.proximity.Attach(this);
      console.log('[ProximityAvatarList] Attached to Proximity');
    } catch (err) {
      console.error('[ProximityAvatarList] Failed to attach to Proximity:', err);
    }
  }

  /**
   * Proximity callback: Local avatar has entered the world.
   * Called once when user is ready to play.
   */
  onUserReady(nAvatarIx: number, dwRPersonaIx: number, nX: number, nY: number, nZ: number): void {
    this.localPersonaID = dwRPersonaIx;
    this.localPosition = { x: nX, y: nY, z: nZ };
    console.log('[ProximityAvatarList] onUserReady: Local avatar', dwRPersonaIx, 'at', nX, nY, nZ);
  }

  /**
   * Proximity callback: External avatar has appeared or updated.
   * Called by Proximity when avatar data changes.
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
   * Proximity callback: External avatar has gone out of range (hidden).
   * Called by Proximity when avatar goes out of proximity range.
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
   * Proximity callback: User has logged out.
   * Clear all tracked avatars.
   */
  onLogout_Client(bVoluntary: boolean): void {
    console.log('[ProximityAvatarList] onLogout_Client:', bVoluntary);
    this.avatars.clear();
    this.localPersonaID = null;
    this.notifyObservers();
  }

  /**
   * Proximity callback: Time tick update.
   * Can be used for periodic operations if needed.
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
   * Clean up: Detach from Proximity.
   */
  dispose(): void {
    if (this.proximity) {
      try {
        this.proximity.Detach(this);
        console.log('[ProximityAvatarList] Detached from Proximity');
      } catch (err) {
        console.error('[ProximityAvatarList] Error detaching:', err);
      }
    }
    this.avatars.clear();
    this.observers.clear();
    this.proximity = null;
  }
}
