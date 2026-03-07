import type { ProximityAudioManager } from '../audio/ProximityAudioManager.js';

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
 * Tracks nearby external avatars from MVRP Proximity events,
 * maintains a sorted list of the 5 closest, and notifies observers of changes.
 */
export class ProximityAvatarList {
  private audioManager: ProximityAudioManager | null = null;
  private avatars: Map<number, AvatarInfo> = new Map();
  private localPosition: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 };
  private observers: Set<(avatars: AvatarInfo[]) => void> = new Set();

  /**
   * Initialize with the ProximityAudioManager to access MVRP Proximity instance.
   */
  init(audioManager: ProximityAudioManager, initialLocalPos?: { x: number; y: number; z: number }): void {
    this.audioManager = audioManager;
    if (initialLocalPos) {
      this.localPosition = initialLocalPos;
    }

    this.setupProximityListeners();
  }

  /**
   * Hook into MVRP Proximity events to track avatar updates.
   */
  private setupProximityListeners(): void {
    if (!this.audioManager) return;

    const proximity = this.audioManager.getProximity();
    if (!proximity) {
      console.warn('[ProximityAvatarList] Proximity not available');
      return;
    }

    // Listen to avatar update events
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    proximity.on('onAvatarUpdate', (event: any) => {
      const { aSBA_RProximity_Avatar_Open_Ex, SBA_RProximity_Avatar_Update_Ex } = event;

      if (aSBA_RProximity_Avatar_Open_Ex && SBA_RProximity_Avatar_Update_Ex) {
        const personaID = aSBA_RProximity_Avatar_Open_Ex.dwRPersonaIx;
        const name = `${aSBA_RProximity_Avatar_Open_Ex.Name.wszForename} ${aSBA_RProximity_Avatar_Open_Ex.Name.wszSurname}`;
        const position = SBA_RProximity_Avatar_Update_Ex.MVO_RAvatar_State.MVO_RPosition_Head;

        this.updateAvatar(personaID, name, position);
      }
    });

    // Listen to avatar removal
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    proximity.on('onAvatarHide', (event: any) => {
      const personaID = event.dwRPersonaIx;
      this.removeAvatar(personaID);
    });

    console.log('[ProximityAvatarList] Listening to Proximity events');
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

    this.notifyObservers();
  }

  /**
   * Remove an avatar from tracking.
   */
  private removeAvatar(personaID: number): void {
    this.avatars.delete(personaID);
    this.notifyObservers();
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
  getClosestAvatars(count = 5): AvatarInfo[] {
    return Array.from(this.avatars.values())
      .sort((a, b) => a.distance - b.distance)
      .slice(0, count);
  }

  /**
   * Update local avatar position for distance calculations.
   */
  setLocalPosition(x: number, y: number, z: number): void {
    this.localPosition = { x, y, z };
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
   * Clean up and stop listening.
   */
  dispose(): void {
    this.avatars.clear();
    this.observers.clear();
    this.audioManager = null;
  }
}
