import { Session } from "../base/Session.js";
import { ConnectionState, PersonaInfo } from "../types/index.js";
import { InWorldSession } from "./InWorldSession.js";

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

  // pRUser instance passed from UserSession via constructor.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private pRUser: any;

  private _firstName: string | undefined;
  private _lastName: string | undefined;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(personaId: string, pLnG: any, pRUser: any, firstName?: string, lastName?: string) {
    super();
    this.personaId = personaId;
    this.pLnG = pLnG;
    this.pRUser = pRUser;
    this._firstName = firstName;
    this._lastName = lastName;
  }

  get personaInfo(): PersonaInfo | null {
    return this._personaInfo;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  get pLnGClient(): any {
    return this.pLnG;
  }

  get pRPersona(): unknown {
    return this._pRPersona;
  }

  async connect(): Promise<void> {
    this.setState(ConnectionState.Connecting);

    if (!this.pLnG) {
      throw new Error(`[PersonaSession] pLnG is not available; cannot open RPersona model`);
    }

    // Step 1: Open the RPersona model directly (like RP1Demo does).
    console.log(`[PersonaSession] Opening RPersona model for ${this.personaId}...`);
    const pRPersona = this.pLnG.Model_Open('RPersona', `${this.personaId}`);
    if (!pRPersona) {
      throw new Error(`[PersonaSession] Model_Open('RPersona', '${this.personaId}') returned null`);
    }
    this._pRPersona = pRPersona;
    console.log(`[PersonaSession] RPersona model opened successfully`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this._pRPersona as any).Attach(this);

    // Step 2: Enter the world with RPERSONA_ENTER.
    console.log(`[PersonaSession] Entering world...`);
    await this.enterPersona();

    // Step 3: Set up persona info and in-world session.
    this._personaInfo = new PersonaInfo(
      this.personaId,
      [this._firstName, this._lastName].filter(Boolean).join(" ") || `Persona_${this.personaId}`,
      "",
      "default_world",
      "default_region"
    );

    this.inWorldSession = new InWorldSession(this._personaInfo, this);
    await this.inWorldSession.connect();

    console.log(`[PersonaSession] Connected! In world as persona ${this.personaId}`);
    this.setState(ConnectionState.InWorld);
  }

  /**
   * Enter the world with this persona by sending RPERSONA_ENTER on pRUser (matching RP1Demo flow).
   * Sends position data matching RP1Demo's guest flow.
   * PersonaPuppet then handles ongoing position updates.
   */
  private async enterPersona(): Promise<void> {
    if (!this._pRPersona) {
      throw new Error('[PersonaSession] RPersona model not open');
    }

    if (!this.pRUser) {
      throw new Error('[PersonaSession] pRUser not available for RPERSONA_ENTER');
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

    console.log(`[enterPersona] Calling RPERSONA_ENTER on pRUser for persona ${this.personaId}`);

    return promisifyAction(
      this.pRUser,
      'RPERSONA_ENTER',
      {
        twRPersonaIx: Number(this.personaId),
        twSessionIz: 0,
        pPosition,
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async (pIAction: any) => {
        const result = pIAction.GetResult();
        console.log(`[enterPersona] RPERSONA_ENTER result: ${result}`);
        if (result !== 0) {
          const errorName = this.getErrorName(result);
          throw new Error(`RPERSONA_ENTER failed: ${result} (${errorName})`);
        }
      }
    );
  }

  /**
   * Map MV error codes to readable names (from MV Library).
   */
  private getErrorName(code: number): string {
    const errors: Record<number, string> = {
      0: 'SUCCESS',
      [-3]: 'INVALIDOBJECT',
      [-18]: 'INVALIDSESSION',
      [-34]: 'INVALIDUSERSESSION',
      [-36]: 'INVALIDUSER',
      [-37]: 'INVALIDRIGHTS',
      [-40]: 'INVALIDSTATE',
      [-45]: 'INVALIDGUEST',
    };
    return errors[code] ?? `UNKNOWN_ERROR_${code}`;
  }

  /** Relay a teleport command to the active in-world session. */
  public teleportTo(celestialId: string, position: { x: number; y: number; z: number }): void {
    if (!this.inWorldSession) {
      console.error('[PersonaSession] No InWorldSession for teleport');
      return;
    }

    this.inWorldSession.teleportTo(celestialId, position);
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
    this.pRUser = null;

    this.setState(ConnectionState.Disconnected);
  }
}
