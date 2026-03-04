import { Session } from "../base/Session.js";
import { ConnectionState, PersonaInfo } from "../types/index.js";
import { PersonaPuppet } from "../avatar/PersonaPuppet.js";
import type { PersonaSession } from "../client/PersonaSession.js";

/**
 * InWorldSession - integrates the active persona with the RP1 world environment.
 * Manages the PersonaPuppet avatar and world-level event handling.
 */
export class InWorldSession extends Session {
  private personaInfo: PersonaInfo;
  private puppet: PersonaPuppet | null = null;
  readonly personaSession: PersonaSession;

  constructor(personaInfo: PersonaInfo, personaSession: PersonaSession) {
    super();
    this.personaInfo = personaInfo;
    this.personaSession = personaSession;
  }

  get avatar(): PersonaPuppet | null {
    return this.puppet;
  }

  async connect(): Promise<void> {
    this.setState(ConnectionState.EnteringWorld);

    this.puppet = new PersonaPuppet(this.personaInfo, this);
    await this.puppet.spawn();

    this.setState(ConnectionState.InWorld);
  }

  async disconnect(): Promise<void> {
    if (this.puppet) {
      await this.puppet.despawn();
      this.puppet = null;
    }
    this.setState(ConnectionState.Disconnected);
  }

  public teleportTo(celestialId: string, position: { x: number; y: number; z: number }): void {
    if (!this.puppet) {
      console.error('[InWorldSession] No puppet for teleport');
      return;
    }

    const twObjectIx = Number(celestialId);
    if (isNaN(twObjectIx)) {
      console.error('[InWorldSession] Invalid celestialId:', celestialId);
      return;
    }

    console.log(`[InWorldSession] Teleporting to celestial ${celestialId}:`, position);

    try {
      const positionUniversal = {
        pParent: {
          twObjectIx,
          wClass: 0,
        },
        pRelative: {
          vPosition: {
            dX: position.x,
            dY: position.y,
            dZ: position.z,
          },
        },
      };

      this.puppet.moveTo(positionUniversal);
    } catch (err) {
      console.error('[InWorldSession] moveTo failed:', err);
    }
  }
}
