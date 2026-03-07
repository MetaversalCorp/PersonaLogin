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
 * Implements the RP1 listener interface to track nearby external avatars.
 * Maintains a sorted list of the 5 closest avatars and notifies observers of changes.
 */
export class ProximityAvatarList {
  private avatars: Map<number, AvatarInfo> = new Map();
  private localPosition: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 };
  private localPersonaID: number | null = null;
  private observers: Set<(avatars: AvatarInfo[]) => void> = new Set();
  private isRegistered: boolean = false;

  /**
   * Initialize the proximity tracker and register with RP1.
   * @param initialLocalPos Optional initial position of the local avatar
   */
  init(initialLocalPos?: { x: number; y: number; z: number }): void {
    if (initialLocalPos) {
      this.localPosition = initialLocalPos;
    }

    // Register this listener with RP1
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rp1 = (globalThis as any).RP1 as { AddListener?: (l: unknown) => void } | undefined;
    if (rp1 && rp1.AddListener) {
      rp1.AddListener(this);
      this.isRegistered = true;
      console.log('[ProximityAvatarList] Registered with RP1');
    } else {
      console.warn('[ProximityAvatarList] RP1 not available');
    }
  }

  /**
   * RP1 callback: Called when the local avatar is ready.
   * Used to track the local persona ID and initial position.
   */
  onUserReady(nAvatarIx: number, dwRPersonaIx: number, nX: number, nY: number, nZ: number): void {
    this.localPersonaID = dwRPersonaIx;
    this.localPosition = { x: nX, y: nY, z: nZ };
    console.log('[ProximityAvatarList] Local avatar ready:', dwRPersonaIx, 'at', this.localPosition);
  }

  /**
   * RP1 callback: Called when a remote avatar's state is updated (position, animation, etc.).
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onModelUpdate(SBA_RProximity_Avatar_Open_Ex: any, dwRPersonaIx: number, MVO_RAvatar_State: any): void {
    // Skip the local avatar
    if (dwRPersonaIx === this.localPersonaID) {
      return;
    }

    // Only process if we have avatar data
    if (!SBA_RProximity_Avatar_Open_Ex || !MVO_RAvatar_State) {
      return;
    }

    const name = `${SBA_RProximity_Avatar_Open_Ex.Name.wszForename} ${SBA_RProximity_Avatar_Open_Ex.Name.wszSurname}`;
    const position = MVO_RAvatar_State.MVO_RPosition_Head;

    if (position) {
      this.updateAvatar(dwRPersonaIx, name, position);
    }
  }

  /**
   * RP1 callback: Called when a remote avatar is removed from the world.
   */
  onModelClose(dwRPersonaIx: number): void {
    // Skip the local avatar
    if (dwRPersonaIx === this.localPersonaID) {
      return;
    }

    this.removeAvatar(dwRPersonaIx);
  }

  /**
   * RP1 callback: Called on a tick (time update).
   * Can be used to periodically recalculate distances.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onTime_Tick(_pParam: any): void {
    // Distances are recalculated on every model update, but we could periodically
    // trigger observer notifications here if needed
  }

  /**
   * RP1 callback: Stub for model hide events.
   */
  onModelHide(_dwRPersonaIx: number): void {
    // Not used for proximity tracking
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

    console.log('[ProximityAvatarList] Updated avatar', personaID, name, '(' + distance.toFixed(2) + 'm)');
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
   * Get the 5 closest avatars, sorted by distance.
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
   * Clean up and unregister from RP1.
   */
  dispose(): void {
    if (this.isRegistered) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rp1 = (globalThis as any).RP1 as { RemoveListener?: (l: unknown) => void } | undefined;
      if (rp1 && rp1.RemoveListener) {
        rp1.RemoveListener(this);
        this.isRegistered = false;
        console.log('[ProximityAvatarList] Unregistered from RP1');
      }
    }

    this.avatars.clear();
    this.observers.clear();
  }
}
