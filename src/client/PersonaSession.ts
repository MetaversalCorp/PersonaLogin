import { Session } from "../base/Session.js";
import { ConnectionState, PersonaInfo } from "../types/index.js";
import { InWorldSession } from "./InWorldSession.js";
import type { PersonaTransform } from "../avatar/PersonaPuppet.js";

/**
 * Wraps a model's Send() call in a Promise using the callback pattern required
 * by the MV server action protocol.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function promisifyAction<T>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pModel: any,
  sAction: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pData: Record<string, any>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  callback: (pIAction: any) => Promise<T>
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sent = (pModel as any).Send(sAction, pData, null, async (pIAction: any) => {
      try {
        resolve(await callback(pIAction));
      } catch (err) {
        reject(err);
      }
    });
    if (!sent) {
      reject(new Error(`[promisifyAction] Failed to send action '${sAction}'`));
    }
  });
}

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
  private _pRPersona: unknown = null;

  // pLnG instance passed from UserSession via constructor; used to open/close
  // the RPersona model and must outlive the PersonaSession.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private pLnG: any;

  private _firstName: string | undefined;
  private _lastName: string | undefined;

  constructor(personaId: string, pLnG: any, firstName?: string, lastName?: string) {
    super();
    this.personaId = personaId;
    this.pLnG = pLnG;
    this._firstName = firstName;
    this._lastName = lastName;
  }

  get personaInfo(): PersonaInfo | null {
    return this._personaInfo;
  }

  get pRPersona(): unknown {
    return this._pRPersona;
  }

  async connect(): Promise<void> {
    this.setState(ConnectionState.Connecting);

    // Use the pLnG instance passed from UserSession to open the RPersona model.
    if (!this.pLnG) {
      throw new Error(`[PersonaSession] pLnG is not available; cannot open RPersona model`);
    }
    const pRPersona = this.pLnG.Model_Open('RPersona', this.personaId);
    if (!pRPersona) {
      throw new Error(`[PersonaSession] Model_Open('RPersona', '${this.personaId}') returned null`);
    }
    this._pRPersona = pRPersona;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this._pRPersona as any).Attach(this);
    await this.enterPersona();

    this._personaInfo = new PersonaInfo(
      this.personaId,
      [this._firstName, this._lastName].filter(Boolean).join(" ") || `Persona_${this.personaId}`,
      "",
      "default_world",
      "default_region"
    );

    this.inWorldSession = new InWorldSession(this._personaInfo, this);
    await this.inWorldSession.connect();

    this.setState(ConnectionState.InWorld);
  }

  /**
   * Enter the world with this persona by sending RPERSONA_ENTER to the persona model.
   * Sends position data matching RP1Demo's guest flow.
   * PersonaPuppet then handles ongoing position updates.
   */
  private enterPersona(): Promise<void> {
    if (!this._pRPersona) {
      throw new Error('RPersona not open');
    }

    const pPosition = {
      pParent: {
        twObjectIx: 104, // startingLocationCelestialID (RP1Demo default)
        wClass: 71,      // metaversal/rp1 celestial object class
      },
      pRelative: {
        vPosition: [50, 25, 6370999.999], // default geopos: lon=50°, lat=25°, radius≈6371km
      },
    };

    return promisifyAction(
      this._pRPersona,
      'RPERSONA_ENTER',
      {
        twRPersonaIx: this.personaId,
        twSessionIz: 0,
        pPosition,
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async (pIAction: any) => {
        const result = pIAction.GetResult();
        if (result !== 0) {
          throw new Error(`RPERSONA_ENTER failed with error ${result}`);
        }
      }
    );
  }

  /** Relay a teleport command to the active persona puppet. */
  teleportTo(
    celestialId: string,
    position: Omit<PersonaTransform, "rotY">
  ): void {
    if (!this.inWorldSession?.avatar) return;

    const transform: PersonaTransform = { ...position, rotY: 0 };
    this.inWorldSession.avatar.moveTo(transform, celestialId);
  }

  async disconnect(): Promise<void> {
    if (this.inWorldSession) {
      await this.inWorldSession.disconnect();
      this.inWorldSession = null;
    }

    // Close the RPersona model via pLnG when available (requires @metaversalcorp/mvrp at runtime).
    if (this.pLnG && this._pRPersona) {
      this.pLnG.Model_Close(this._pRPersona);
    }
    this._pRPersona = null;
    this.pLnG = null;
    this._personaInfo = null;

    this.setState(ConnectionState.Disconnected);
  }
}
