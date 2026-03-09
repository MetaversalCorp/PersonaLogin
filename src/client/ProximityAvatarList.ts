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
 * Tracks nearby external avatars by intercepting Proximity's onAvatarUpdate
 * event which provides batch avatar updates with position data.
 * Maintains a sorted list of the 10 closest avatars and notifies observers of changes.
 */
export class ProximityAvatarList {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private proximity: any = null;
  private avatars: Map<number, AvatarInfo> = new Map();
  private avatarNames: Map<number, string> = new Map();
  private activeIDs: Set<number> = new Set();
  private localPosition: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 };
  private localPersonaID: number | null = null;
  private observers: Set<(avatars: AvatarInfo[]) => void> = new Set();

  /**
   * Initialize and hook into the Proximity instance.
   * Uses Proximity.Attach() to register as a listener.
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
    this.setupProximityListeners();

    console.log('[ProximityAvatarList] Initialized and hooked into Proximity');
  }

  /**
   * Update the local persona's ID and Cartesian position.
   * Called from InWorldSession.teleportTo() whenever the user teleports.
   * This keeps the proximity list synchronized with the actual avatar position.
   *
   * @param personaID The local persona's ID
   * @param position The Cartesian position {x, y, z} in global coordinates
   */
  public updateLocalPosition(personaID: number, position: { x: number; y: number; z: number }): void {
    this.localPersonaID = personaID;
    this.localPosition = { x: position.x, y: position.y, z: position.z };
    console.log('[ProximityAvatarList] Local position updated: persona', personaID, 'at',
      position.x.toFixed(2), position.y.toFixed(2), position.z.toFixed(2));

    // Recalculate distances for all tracked avatars
    this.recalculateDistances();
  }

  /**
   * Recalculate distances for all tracked avatars after local position changes.
   */
  private recalculateDistances(): void {
    let changed = false;
    for (const [, avatar] of this.avatars) {
      const newDistance = this.calculateDistance(avatar.position);
      if (newDistance !== avatar.distance) {
        avatar.distance = newDistance;
        changed = true;
      }
    }

    if (changed) {
      console.log('[ProximityAvatarList] Distances recalculated for', this.avatars.size, 'avatars');
      this.notifyObservers();
    }
  }

  /**
   * Register event listeners using Proximity.Attach() pattern.
   * This keeps handlers outside the packet parsing callstack.
   */
  private setupProximityListeners(): void {
    if (!this.proximity || typeof this.proximity.Attach !== 'function') {
      console.warn('[ProximityAvatarList] Proximity.Attach not found');
      return;
    }

    // Register this instance as a listener
    this.proximity.Attach(this);

    console.log('[ProximityAvatarList] Attached to Proximity event listeners');
  }

  /**
   * Handle onAvatarUpdate event with batch avatar data.
   * The event contains:
   * - aSBA_RProximity_Avatar_Open_Ex: Array of avatar metadata (dwRPersonaIx, Name, etc.)
   * - SBA_RProximity_Avatar_Update_Ex: Avatar state with position data
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handleAvatarUpdate(eventData: any): void {
    if (!eventData) return;

    const avatarOpenExArray = eventData.aSBA_RProximity_Avatar_Open_Ex;
    const avatarUpdateEx = eventData.SBA_RProximity_Avatar_Update_Ex;

    if (!avatarUpdateEx) {
      console.warn('[ProximityAvatarList] No avatar update data in event');
      return;
    }

    const dwRPersonaIx = avatarUpdateEx.twRPersonaIx;

    // Skip the local avatar
    if (dwRPersonaIx === this.localPersonaID) {
      return;
    }

    ///console.log('[ProximityAvatarList] Processing avatar update for:', dwRPersonaIx);

    // Extract position from pState.pPosition_Head.pRelative.vPosition
    const pState = avatarUpdateEx.pState;
    if (!pState || !pState.pPosition_Head) {
      console.warn('[ProximityAvatarList] No position data in avatar update');
      return;
    }

    const vPosition = pState.pPosition_Head?.pRelative?.vPosition;
    if (!vPosition) {
      console.warn('[ProximityAvatarList] No vPosition in pPosition_Head');
      return;
    }

    const position = {
      x: vPosition.dX,
      y: vPosition.dY,
      z: vPosition.dZ,
    };

    const distance = this.calculateDistance(position);

    // Determine if this is a new avatar (first appearance)
    const isNew = !this.avatars.has(dwRPersonaIx);

    // Extract name from aSBA_RProximity_Avatar_Open_Ex by matching persona ID
    let name = 'Unknown';
    if (avatarOpenExArray && Array.isArray(avatarOpenExArray)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const avatarOpenEx = avatarOpenExArray.find((a: any) => a.dwRPersonaIx === dwRPersonaIx);
      if (avatarOpenEx && avatarOpenEx.Name) {
        const forename = avatarOpenEx.Name.wszForename || '';
        const surname = avatarOpenEx.Name.wszSurname || '';
        const fullName = (forename + ' ' + surname).trim();
        if (fullName) {
          name = fullName;
          this.avatarNames.set(dwRPersonaIx, name);
        }
      }
    }
    // Use cached name for updates without Name data
    if (name === 'Unknown' && this.avatarNames.has(dwRPersonaIx)) {
      name = this.avatarNames.get(dwRPersonaIx) || 'Unknown';
    }

    this.avatars.set(dwRPersonaIx, {
      personaID: dwRPersonaIx,
      name,
      position,
      distance,
    });

    this.activeIDs.add(dwRPersonaIx);

    ///console.log('[ProximityAvatarList] Avatar updated:', dwRPersonaIx, name, distance.toFixed(2) + 'm', isNew ? '(NEW)' : '(UPDATE)');
    this.notifyObservers();
  }

  /**
   * Proximity event handler: Called when avatar update batch arrives.
   * This runs OUTSIDE the packet parsing callstack.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onAvatarUpdate(pNotice: any): void {
    if (!pNotice || !pNotice.pData) return;
    this.handleAvatarUpdate(pNotice.pData);
  }

  /**
   * Proximity event handler: Called when avatar closes (leaves world permanently).
   * Avatar is fully deleted from both the map and activeIDs.
   * Note: onAvatarClose fires after onAvatarHide in the avatar lifecycle, which
   * ensures inactive entries from onAvatarHide are eventually cleaned up.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onAvatarClose(pNotice: any): void {
    if (!pNotice || !pNotice.pData) return;
    const twRPersonaIx = pNotice.pData.twRPersonaIx;
    console.log('[ProximityAvatarList] onAvatarClose:', twRPersonaIx);
    this.activeIDs.delete(twRPersonaIx);
    this.onModelClose(twRPersonaIx);
  }

  /**
   * Proximity event handler: Called when avatar hides (goes temporarily out of range).
   * Marks avatar inactive instead of deleting - prevents audio buffer corruption
   * during MVRP packet parsing. Follows RP1Demo ExternalAvatarsController pattern.
   * The avatar remains in this.avatars; it will be fully removed when onAvatarClose fires.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onAvatarHide(pNotice: any): void {
    if (!pNotice || !pNotice.pData) return;
    const twRPersonaIx = pNotice.pData.twRPersonaIx;
    console.log('[ProximityAvatarList] onAvatarHide:', twRPersonaIx);

    // Only mark inactive - do NOT delete the avatar or call notifyObservers()
    // Deleting during packet parsing corrupts the audio buffer.
    // The avatar will be fully removed when onAvatarClose fires.
    this.activeIDs.delete(twRPersonaIx);
  }

  /**
   * Proximity event handler: Called when user is ready.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onUserReady(...args: any[]): void {
    if (args.length >= 5) {
      const [, dwRPersonaIx, nX, nY, nZ] = args;
      console.log('[ProximityAvatarList] onUserReady:', dwRPersonaIx);
      this.updateLocalPosition(dwRPersonaIx, { x: nX, y: nY, z: nZ });
    }
  }

  /**
   * Proximity event handler: Called when client logs out.
   */
  onLogout_Client(bVoluntary: boolean): void {
    console.log('[ProximityAvatarList] onLogout_Client:', bVoluntary);
    this.handleLogoutClient(bVoluntary);
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
  private handleLogoutClient(bVoluntary: boolean): void {
    this.avatars.clear();
    this.avatarNames.clear();
    this.activeIDs.clear();
    this.localPersonaID = null;
    this.notifyObservers();
  }

  /**
   * Calculate Euclidean distance from local avatar to remote avatar.
   * Handles world coordinates (dX, dY, dZ format).
   */
  private calculateDistance(position: { x: number; y: number; z: number }): number {
    const dx = position.x - this.localPosition.x;
    const dy = position.y - this.localPosition.y;
    const dz = position.z - this.localPosition.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  /**
   * Get the 10 closest avatars, sorted by distance.
   * Only returns avatars that are currently active (not hidden).
   */
  getClosestAvatars(count: number = 10): AvatarInfo[] {
    return Array.from(this.avatars.values())
      .filter(avatar => this.activeIDs.has(avatar.personaID))
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
    const closestAvatars = this.getClosestAvatars(10);
    for (const observer of this.observers) {
      observer(closestAvatars);
    }
  }

  /**
   * Clean up: Detach from Proximity listeners.
   */
  dispose(): void {
    if (this.proximity && typeof this.proximity.Detach === 'function') {
      try {
        this.proximity.Detach(this);
        console.log('[ProximityAvatarList] Detached from Proximity');
      } catch (err) {
        console.error('[ProximityAvatarList] Error during cleanup:', err);
      }
    }
    this.avatars.clear();
    this.avatarNames.clear();
    this.activeIDs.clear();
    this.observers.clear();
    this.proximity = null;
  }
}
