// IRP1ClientListener is a runtime global provided by MV.js (MVRP vendor script).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const IRP1ClientListener: any;
// RP1 is the global RP1 client instance provided by MV.js at runtime.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const RP1: any;

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
 * Listens to RP1 proximity events to track nearby external avatars.
 * Follows the RP1Demo pattern exactly:
 *   - Extends IRP1ClientListener
 *   - Implements onModelUpdate, onModelClose, onUserReady callbacks
 *   - Registers with RP1.AddListener(this)
 *   - RP1 calls our methods when Proximity emits events
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class ProximityAvatarList extends (typeof IRP1ClientListener !== 'undefined' ? IRP1ClientListener : Object) {
  private avatars: Map<number, AvatarInfo> = new Map();
  private localPosition: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 };
  private localPersonaID: number | null = null;
  private observers: Set<(avatars: AvatarInfo[]) => void> = new Set();
  private isRegistered: boolean = false;

  /**
   * Initialize the proximity tracker and register with RP1.
   * This will cause RP1 to call our onModelUpdate/onModelClose methods
   * whenever Proximity emits events.
   */
  init(): void {
    // Register this listener with RP1
    if (typeof RP1 !== 'undefined' && RP1.AddListener) {
      RP1.AddListener(this);
      this.isRegistered = true;
      console.log('[ProximityAvatarList] Registered with RP1');
    } else {
      console.warn('[ProximityAvatarList] RP1 not available');
    }
  }

  /**
   * RP1 callback: Called when the local avatar is ready in the world.
   * Receives the initial position and persona ID.
   */
  onUserReady(nAvatarIx: number, dwRPersonaIx: number, nX: number, nY: number, nZ: number): void {
    this.localPersonaID = dwRPersonaIx;
    this.localPosition = { x: nX, y: nY, z: nZ };
    console.log('[ProximityAvatarList] Local avatar ready:', dwRPersonaIx, 'at', nX, nY, nZ);
  }

  /**
   * RP1 callback: Called when a remote avatar's state is updated.
   * This includes position, animation, gesture, etc.
   * Called by RP1 when Proximity emits onAvatarUpdate.
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
   * RP1 callback: Called when a remote avatar leaves the proximity.
   */
  onModelClose(dwRPersonaIx: number): void {
    // Skip the local avatar
    if (dwRPersonaIx === this.localPersonaID) {
      return;
    }

    this.removeAvatar(dwRPersonaIx);
  }

  /**
   * RP1 callback: Called when an avatar hides (goes out of range but not fully removed).
   */
  onModelHide(dwRPersonaIx: number): void {
    // For proximity list, treat hide the same as close
    this.removeAvatar(dwRPersonaIx);
  }

  /**
   * RP1 callback: Called on time tick updates.
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
   * Clean up and unregister from RP1.
   */
  dispose(): void {
    if (this.isRegistered && typeof RP1 !== 'undefined' && RP1.RemoveListener) {
      try {
        RP1.RemoveListener(this);
        this.isRegistered = false;
        console.log('[ProximityAvatarList] Unregistered from RP1');
      } catch (err) {
        console.error('[ProximityAvatarList] Error unregistering from RP1:', err);
      }
    }

    this.avatars.clear();
    this.observers.clear();
  }
}
