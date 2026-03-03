// MV is a global namespace populated by side-effect imports in LnG.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const MV: any;

import { Session } from '../base/Session.js';
import { ConnectionState } from '../types/index.js';
import { getPFabric, LnGUser, LnGPersona } from '../mv/LnG.js';
import { PersonaSession } from './PersonaSession.js';
import type { PersonaTransform } from '../avatar/PersonaPuppet.js';

/** Simple geographic coordinate used for persona spawn placement. */
interface SimpleGeoPos {
  lat: number;    // degrees
  lon: number;    // degrees
  radius: number; // metres (planet radius + altitude)
}

/**
 * Convert a simple lat/lon/radius geo position to a Double3 cartesian vector
 * in the Y-up coordinate system used by the MV position protocol.
 */
function geoPosSimpleToDouble3(geoPos: SimpleGeoPos): { dX: number; dY: number; dZ: number } {
  const lat = geoPos.lat * Math.PI / 180;
  const lon = geoPos.lon * Math.PI / 180;
  const r = geoPos.radius;
  const cosLat = Math.cos(lat);
  return {
    dX: r * cosLat * Math.sin(lon),
    dY: r * Math.sin(lat),
    dZ: r * cosLat * Math.cos(lon),
  };
}

/**
 * Apply a small random scatter to a starting geo position to spread out
 * persona spawn points and avoid stacking all new personas at the same spot.
 */
function applyScatterToStartGeoPos(geoPos: SimpleGeoPos): SimpleGeoPos {
  const scatter = 0.001; // ~111 m scatter radius at the equator
  return {
    lat: geoPos.lat + (Math.random() - 0.5) * scatter,
    lon: geoPos.lon + (Math.random() - 0.5) * scatter,
    radius: geoPos.radius,
  };
}

/**
 * Wraps a model's Send() call in a Promise using the callback pattern required
 * by the MV server action protocol.
 *
 * @param pModel    The model object (e.g. pRUser) with a Send() method.
 * @param sAction   The action name (e.g. 'RPERSONA_OPEN').
 * @param pData     Request fields to merge into pIAction.pRequest.
 * @param callback  Called with the completed pIAction; may be async and should
 *                  call pIAction.GetResult() to check for errors.
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
    const sent = pModel.Send(sAction, pData, null, async (pIAction: any) => {
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
 * UserSession — manages the authenticated user's RUser model and delegates
 * persona lifecycle to PersonaSession.
 *
 * Integrates with @metaversalcorp/mvrp for user/persona protocol handling via
 * the pLnG instance provided by the MSF fabric (getPFabric().pLnG).
 */
export class UserSession extends Session {
  private readonly user: LnGUser;
  private _personaSession: PersonaSession | null = null;
  private _pRUser: unknown = null;
  private _ownPersonaList: LnGPersona[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _friendsService: any = null;

  /** Celestial object ID used as the parent reference when placing a new persona. */
  startingLocationCelestialID: number | string = 0;

  /** Starting geographic position used as the base for new-persona spawn scatter. */
  private _startGeoPos: SimpleGeoPos = { lat: 0, lon: 0, radius: 6_371_000 };

  constructor(user: LnGUser) {
    super();
    this.user = user;
  }

  get userId(): string {
    return this.user.id;
  }

  get username(): string {
    return this.user.displayName;
  }

  get ownPersonaList(): LnGPersona[] {
    return this._ownPersonaList;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private get pLnG(): any {
    return getPFabric()?.pLnG ?? null;
  }

  /**
   * Initialize the UserSession by opening the RUser model via pLnG.
   * Reads the user's persona list from pRUser.ownPersonaList.
   */
  async connect(): Promise<void> {
    this.setState(ConnectionState.Connecting);

    const pLnG = this.pLnG;
    if (pLnG) {
      const pRUser = pLnG.Model_Open('RUser', this.user.id);
      if (pRUser) {
        this._pRUser = pRUser;
        this._ownPersonaList = [...(pRUser.ownPersonaList ?? [])];
      }
    } else {
      this._ownPersonaList = [...this.user.personas];
    }

    this.setState(ConnectionState.Connected);
  }

  /**
   * Enter the world with the selected persona.
   * Uses the setupPersonaSession() pattern for consistency with createPersona().
   */
  async pickPersona(personaId: string): Promise<void> {
    const persona = this._ownPersonaList.find((p) => p.id === personaId);
    return new Promise<void>((resolve) =>
      this.setupPersonaSession(personaId, resolve, persona?.firstName ?? '', persona?.lastName)
    );
  }

  /**
   * Create a new persona via the RPERSONA_OPEN server action on the RUser model,
   * then enter the world with that persona.
   */
  async createPersona(firstName: string, lastName?: string): Promise<void> {
    if (!firstName.trim()) {
      throw new Error("Forename is required");
    }

    const pLnG = this.pLnG;

    if (pLnG && this._pRUser) {
      const geoPosScattered = applyScatterToStartGeoPos(this._startGeoPos);
      await promisifyAction(
        this._pRUser,
        'RPERSONA_OPEN',
        {
          twRUserIx: BigInt(this.user.id),
          // qwMapIx_Home: 0 — plain number; server assigns a default home map.
          qwMapIx_Home: 0,
          pName: {
            wsForename: firstName,
            wsSurname: lastName ?? '',
            // dwSequence: 0 — server assigns the disambiguation sequence number.
            dwSequence: 0,
          },
          pPosition: {
            pParent: {
              twObjectIx: this.startingLocationCelestialID,
              wClass: MV.MVMF.Core.Namespace_Get('metaversal/rp1').SourceClass_Get('MVSB', 'RMCObject').pSource_Factory.pReference.wClass,
            },
            pRelative: {
              vPosition: geoPosSimpleToDouble3(geoPosScattered),
            },
          },
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async (pIAction: any) => {
          const result = pIAction.GetResult();
          if (result === 0) {
            const id = pIAction.pResponse!.twRPersonaIx;
            return new Promise<void>((resolve) =>
              this.setupPersonaSession(String(id), resolve, firstName, lastName)
            );
          } else {
            throw new Error(`Persona creation failed (error ${result})`);
          }
        }
      );
    } else {
      const personaId = `${firstName}${lastName ? `_${lastName}` : ''}_${Date.now()}`;
      this._personaSession = new PersonaSession(personaId, pLnG, firstName, lastName);
      await this._personaSession.connect();
      this._initFriendsService();
    }
  }

  /**
   * Close the active PersonaSession and the RUser model.
   */
  async disconnect(): Promise<void> {
    this._friendsService = null;

    if (this._personaSession) {
      await this._personaSession.disconnect();
      this._personaSession = null;
    }

    const pLnG = this.pLnG;
    if (pLnG && this._pRUser) {
      pLnG.Model_Close(this._pRUser);
    }
    this._pRUser = null;
    this._ownPersonaList = [];

    this.setState(ConnectionState.Disconnected);
  }

  /**
   * Relay a teleport command to the active PersonaSession.
   */
  teleportTo(celestialId: string, position: Omit<PersonaTransform, 'rotY'>): void {
    this._personaSession?.teleportTo(celestialId, position);
  }

  /**
   * Set up a PersonaSession for the given persona ID after successful creation,
   * then resolve the enclosing promise once the session is connected.
   */
  private setupPersonaSession(
    id: string,
    resolve: (value: void | PromiseLike<void>) => void,
    firstName: string,
    lastName?: string
  ): void {
    this._personaSession = new PersonaSession(id, this.pLnG, firstName, lastName);
    void this._personaSession.connect().then(() => {
      this._initFriendsService();
      resolve();
    });
  }

  /**
   * Initialize the friends service via pFabric.GetLnG("friends").
   * Uses the Attach/onReadyState event pattern to wait for readiness.
   */
  private _initFriendsService(): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pFabric: any = getPFabric();
    if (!pFabric) return;

    const friendsLnG = pFabric.GetLnG('friends');
    if (!friendsLnG) return;

    if (friendsLnG.IsReady()) {
      this._friendsService = friendsLnG;
      return;
    }

    const listener = {
      onReadyState: () => {
        if (friendsLnG.IsReady()) {
          pFabric.Detach(listener);
          this._friendsService = friendsLnG;
        }
      },
    };
    pFabric.Attach(listener);
  }
}