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
 * Attaches itself to the Proximity instance and receives onModelUpdate/onModelClose callbacks.
 * Maintains a sorted list of the 5 closest avatars and notifies observers of changes.
 */
export class ProximityAvatarList {
  private avatars: Map<number, AvatarInfo> = new Map();
  private localPosition: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 };
  private localPersonaID: number | null = null;
  private observers: Set<(avatars: AvatarInfo[]) => void> = new Set();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private proximity: any = null;
  private isAttached: boolean = false;

  /**
   * Initialize the proximity tracker and attach to the Proximity instance.
   * @param proximity The MVRP Proximity instance from ProximityAudioManager.getProximity()
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  init(proximity: any): void {
    if (!proximity) {
      console.warn('[ProximityAvatarList] Proximity instance is null');
      return;
    }

    this.proximity = proximity;

    // Attach this listener to the Proximity instance so it calls our callbacks
    try {
      this.proximity.Attach(this);
      this.isAttached = true;
      console.log('[ProximityAvatarList] Attached to Proximity instance');
    } catch (err) {
      console.error('[ProximityAvatarList] Failed to attach to Proximity:', err);
    }
  }

  /**
   * Proximity callback: Called when the local avatar is ready in the world.
   * Receives the initial position and persona ID.
   */
  onUserReady(nAvatarIx: number, dwRPersonaIx: number, nX: number, nY: number, nZ: number): void {
    this.localPersonaID = dwRPersonaIx;
    this.localPosition = { x: nX, y: nY, z: nZ };
    console.log('[ProximityAvatarList] Local avatar ready:', dwRPersonaIx, 'at', nX, nY, nZ);
  }

  /**
   * Proximity callback: Called when a remote avatar's state is updated.
   * This includes position, animation, gesture, etc.
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
      name = `${SBA_RProximity_Avatar_Open_Ex.Name.wszForename} ${SBA_RProximity_Avatar_Open_Ex.Name.wszSurname}`;
    } else {
      const existing = this.avatars.get(dwRPersonaIx);
      if (!existing) return;
      name = existing.name;
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

    this.removeAvatar(dwRPersonaIx);
  }

  /**
   * Proximity callback: Called when an avatar hides (goes out of range but not fully removed).
   */
  onModelHide(dwRPersonaIx: number): void {
    // For proximity list, treat hide the same as close
    this.removeAvatar(dwRPersonaIx);
  }

  /**
   * Proximity callback: Called on time tick updates.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onTime_Tick(_pParam: any): void {
    // Distances are recalculated on every model update; no action needed here
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
   * Clean up and detach from Proximity.
   */
  dispose(): void {
    if (this.isAttached && this.proximity) {
      try {
        this.proximity.Detach(this);
        this.isAttached = false;
        console.log('[ProximityAvatarList] Detached from Proximity');
      } catch (err) {
        console.error('[ProximityAvatarList] Error detaching from Proximity:', err);
      }
    }

    this.avatars.clear();
    this.observers.clear();
    this.proximity = null;
  }
}
