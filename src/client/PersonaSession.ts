import { Session } from "../base/Session.js";
import { ConnectionState, PersonaInfo } from "../types/index.js";
import { InWorldSession } from "./InWorldSession.js";
import type { PersonaTransform } from "../avatar/PersonaPuppet.js";
import { getPFabric } from "../mv/LnG.js";

/**
 * PersonaSession - manages a pRPersona instance and transitions to InWorldSession.
 * Integrates with @metaversalcorp/mvrp for persona protocol handling.
 *
 * Authentication is handled by MV LnG upstream; PersonaSession receives only
 * the persona ID selected via UserSession.pickPersona().
 */
export class PersonaSession extends Session {
  readonly personaId: string;
  private inWorldSession: InWorldSession | null = null;
  private _personaInfo: PersonaInfo | null = null;

  // pRPersona instance from @metaversalcorp/mvrp.
  // Type is kept as `unknown` because the private package cannot be resolved
  // in open-source builds; cast to the real type when the package is available.
  // import('@metaversalcorp/mvrp').RPersona
  private pRPersona: unknown = null;

  // pLnG instance retrieved from pFabric at connect time; used to open/close
  // the RPersona model and must outlive the PersonaSession.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private pLnG: any = null;

  constructor(personaId: string) {
    super();
    this.personaId = personaId;
  }

  get personaInfo(): PersonaInfo | null {
    return this._personaInfo;
  }

  async connect(): Promise<void> {
    this.setState(ConnectionState.Connecting);

    // Retrieve the pLnG instance that was used during authentication and open
    // the RPersona model so that Send() can be called on a real object.
    // Falls back to a stub when MV vendor scripts are absent (open-source builds).
    this.pLnG = getPFabric()?.pLnG ?? null;
    if (this.pLnG) {
      this.pRPersona = this.pLnG.Model_Open('RPersona', this.personaId) ?? { personaId: this.personaId };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.pRPersona as any)?.Attach?.(this);
    } else {
      this.pRPersona = { personaId: this.personaId };
    }

    this._personaInfo = new PersonaInfo(
      this.personaId,
      `Persona_${this.personaId}`,
      "",
      "default_world",
      "default_region"
    );

    this.inWorldSession = new InWorldSession(this._personaInfo);
    await this.inWorldSession.connect();

    this.setState(ConnectionState.InWorld);
  }

  /** Relay a teleport command to the active persona puppet. */
  teleportTo(
    celestialId: string,
    position: Omit<PersonaTransform, "rotY">
  ): void {
    if (!this.inWorldSession?.avatar) return;

    const transform: PersonaTransform = { ...position, rotY: 0 };
    this.inWorldSession.avatar.moveTo(transform);
    this.inWorldSession.avatar.sendUpdate(celestialId);
    this.sendUpdate(celestialId, transform);
  }

  /** Encode current avatar position/rotation and send an UPDATE to the persona service. */
  private sendUpdate(celestialId: string, transform: PersonaTransform): void {
    const tmStamp = Date.now();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rPersona = this.pRPersona as any;
    if (!rPersona?.Send) {
      console.log(`[PersonaSession] sendUpdate ${celestialId}`, { tmStamp, transform });
      return;
    }

    const sinHalf = Math.sin(transform.rotY / 2);
    const cosHalf = Math.cos(transform.rotY / 2);
    const rotDwV = rPersona.Quat_Encode([0, sinHalf, 0, cosHalf]);

    rPersona.Send('UPDATE', {
      tmStamp,
      pState: {
        pPosition_Head: {
          pParent: { twObjectIx: celestialId, wClass: 0 },
          pRelative: {
            vPosition: { dX: transform.x, dY: transform.y, dZ: transform.z },
          },
        },
        pRotation_Head: { dwV: rotDwV },
        pRotation_Body: { dwV: rotDwV },
      },
    });
  }

  async disconnect(): Promise<void> {
    if (this.inWorldSession) {
      await this.inWorldSession.disconnect();
      this.inWorldSession = null;
    }

    // Close the RPersona model via pLnG when available (requires @metaversalcorp/mvrp at runtime).
    if (this.pLnG && this.pRPersona) {
      this.pLnG.Model_Close(this.pRPersona);
    }
    this.pRPersona = null;
    this.pLnG = null;
    this._personaInfo = null;

    this.setState(ConnectionState.Disconnected);
  }
}
