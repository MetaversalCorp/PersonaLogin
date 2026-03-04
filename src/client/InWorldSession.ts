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
    if (!this.personaSession || !this.personaSession.pRPersona) {
      console.error('[InWorldSession] No PersonaSession or pRPersona for teleport');
      return;
    }

    console.log(`[InWorldSession] Sending UPDATE to reposition to ${celestialId}:`, position);

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pRPersona = this.personaSession.pRPersona as any;

      const tmStamp: number = typeof pRPersona.pTime === 'number' ? pRPersona.pTime : Date.now();
      const updatePayload = {
        tmStamp,
        pState: {
          bControl: true,
          bVolume: 0,
          wFlag: 0,
          bSerial_A: 0,
          bSerial_B: 0,
          wOrder: 0,
          bCoordSys: 156, // Universal coordinate system (matches RP1Demo PersonaPuppet)
          pPosition_Head: {
            pParent: {
              twObjectIx: Number(celestialId),
              wClass: 0,
            },
            pRelative: {
              vPosition: {
                dX: position.x,
                dY: position.y,
                dZ: position.z,
              },
            },
          },
          pRotation_Head: {
            dwV: pRPersona.Quat_Encode([0, 0, 0, 1]),
          },
          pRotation_Body: {
            dwV: pRPersona.Quat_Encode([0, 0, 0, 1]),
          },
          pPosition_Hand_Left: {
            dwV: pRPersona.Vect_Encode([0, 0, 0]),
          },
          pRotation_Hand_Left: {
            dwV: pRPersona.Quat_Encode([0, 0, 0, 1]),
          },
          pPosition_Hand_Right: {
            dwV: pRPersona.Vect_Encode([0, 0, 0]),
          },
          pRotation_Hand_Right: {
            dwV: pRPersona.Quat_Encode([0, 0, 0, 1]),
          },
          bHand_Left: Array.from(new Uint8Array(6)),   // Default neutral hand grip (all zeros)
          bHand_Right: Array.from(new Uint8Array(6)),  // Default neutral hand grip (all zeros)
          bFace: [24, 23, 22, 21],                     // Default neutral face expression
        },
        wSamples: 0,
        wCodec: 0,
        wSize: 0,
        abData: new Uint8Array(0),
      };

      console.log('[InWorldSession] Calling pRPersona.Send("UPDATE", ...)');
      pRPersona.Send('UPDATE', updatePayload);
      console.log('[InWorldSession] UPDATE sent successfully');
    } catch (err) {
      console.error('[InWorldSession] UPDATE Send failed:', err);
      throw err;
    }
  }
}
