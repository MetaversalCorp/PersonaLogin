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
 * Listens to Proximity events to track nearby external avatars.
 * Attaches directly to the Proximity instance using Proximity.Attach(this).
 * Implements callback methods that Proximity will invoke.
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
   * @param proximity The MVRP Proximity instance from audioManager.getProximity()
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  init(proximity: any): void {
    if (!proximity) {
      console.warn('[ProximityAvatarList] Proximity instance is null');
      return;
    }

    this.proximity = proximity;

    // Attach this listener to Proximity.
    // This causes Proximity to call our onModelUpdate, onModelClose, onUserReady methods.
    try {
      this.proximity.Attach(this);
      console.log('[ProximityAvatarList] Attached to Proximity');
    } catch (err) {
      console.error('[ProximityAvatarList] Failed to attach to Proximity:', err);
    }
  }

  /**
   * Proximity callback: Called when the local avatar enters the world.
   */
  onUserReady(nAvatarIx: number, dwRPersonaIx: number, nX: number, nY: number, nZ: number): void {
    this.localPersonaID = dwRPersonaIx;
    this.localPosition = { x: nX, y: nY, z: nZ };
    console.log('[ProximityAvatarList] Local avatar ready:', dwRPersonaIx, 'at', nX, nY, nZ);
  }

  /**
   * Proximity callback: Called when a remote avatar's state is updated.
   * SBA_RProximity_Avatar_Open_Ex is only present on first appearance (avatar opening).
   * On subsequent updates, it is null but MVO_RAvatar_State is always present.
   *
   * @param SBA_RProximity_Avatar_Open_Ex Avatar metadata (name, ID) - only present on first appearance
   * @param dwRPersonaIx The persona ID of the avatar
   * @param MVO_RAvatar_State Current state including position, rotation, etc.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onModelUpdate(SBA_RProximity_Avatar_Open_Ex: any, dwRPersonaIx: number, MVO_RAvatar_State: any): void {
    // Skip the local avatar
    if (dwRPersonaIx === this.localPersonaID) {
      return;
    }

    // SBA_RProximity_Avatar_Open_Ex is only present on the first appearance of an avatar.
    // For subsequent updates, preserve the stored name.
    // If the avatar is not yet tracked and metadata is missing, skip — we cannot identify it.
    let name: string;
    if (SBA_RProximity_Avatar_Open_Ex) {
      const forename = SBA_RProximity_Avatar_Open_Ex.Name?.wszForename ?? '';
      const surname = SBA_RProximity_Avatar_Open_Ex.Name?.wszSurname ?? '';
      name = `${forename} ${surname}`.trim() || `Avatar ${dwRPersonaIx}`;
      console.log('[ProximityAvatarList] onModelUpdate (NEW):', dwRPersonaIx, name);
    } else {
      const existing = this.avatars.get(dwRPersonaIx);
      if (!existing) return;
      name = existing.name;
      console.log('[ProximityAvatarList] onModelUpdate (UPDATE):', dwRPersonaIx);
    }

    const position = MVO_RAvatar_State?.MVO_RPosition_Head;
    if (position) {
      this.updateAvatar(dwRPersonaIx, name, position);
    }
  }

  /**
   * Proximity callback: Called when a remote avatar leaves the proximity.
   */
  onModelClose(dwRPersonaIx: number): void {
    // Skip the local avatar
    if (dwRPersonaIx === this.localPersonaID) {
      return;
    }

    console.log('[ProximityAvatarList] onModelClose:', dwRPersonaIx);
    this.removeAvatar(dwRPersonaIx);
  }

  /**
   * Proximity callback: Called when an avatar hides (goes out of range but not fully removed).
   */
  onModelHide(dwRPersonaIx: number): void {
    console.log('[ProximityAvatarList] onModelHide:', dwRPersonaIx);
    this.removeAvatar(dwRPersonaIx);
  }

  /**
   * Update or add an avatar to the tracking list.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private updateAvatar(personaID: number, name: string, position: any): void {
    const distance = this.calculateDistance(position);

    this.avatars.set(personaID, {
      personaID,
      name,
      position: { x: position.nX, y: position.nY, z: position.nZ },
      distance,
    });

    console.log('[ProximityAvatarList] Updated avatar', personaID, name, `(${distance.toFixed(2)}m)`);
    this.notifyObservers();
  }

  /**
   * Remove an avatar from tracking.
   */
  private removeAvatar(personaID: number): void {
    const avatar = this.avatars.get(personaID);
    if (avatar) {
      console.log('[ProximityAvatarList] Removed avatar', personaID, avatar.name);
      this.avatars.delete(personaID);
      this.notifyObservers();
    }
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
   * Get the closest avatars, sorted by distance.
   */
  getClosestAvatars(count: number = 5): AvatarInfo[] {
    return Array.from(this.avatars.values())
      .sort((a, b) => a.distance - b.distance)
      .slice(0, count);
  }

  /**
   * Update local avatar position for distance calculations.
   */
  setLocalPosition(x: number, y: number, z: number): void {
    this.localPosition = { x, y, z };
    // Recalculate all distances
    for (const avatar of this.avatars.values()) {
      const pos = { nX: avatar.position.x, nY: avatar.position.y, nZ: avatar.position.z };
      avatar.distance = this.calculateDistance(pos);
    }
    this.notifyObservers();
  }

  /**
   * Register an observer to be notified when the avatar list changes.
   */
  addObserver(callback: (avatars: AvatarInfo[]) => void): void {
    this.observers.add(callback);
  }

  /**
   * Unregister an observer.
   */
  removeObserver(callback: (avatars: AvatarInfo[]) => void): void {
    this.observers.delete(callback);
  }

  /**
   * Notify all observers of changes.
   */
  private notifyObservers(): void {
    const closestAvatars = this.getClosestAvatars(5);
    for (const observer of this.observers) {
      observer(closestAvatars);
    }
  }

  /**
   * Clean up and detach from Proximity.
   */
  dispose(): void {
    if (this.proximity) {
      try {
        this.proximity.Detach(this);
        console.log('[ProximityAvatarList] Detached from Proximity');
      } catch (err) {
        console.error('[ProximityAvatarList] Error detaching from Proximity:', err);
      }
      this.proximity = null;
    }

    this.avatars.clear();
    this.observers.clear();
  }
}
