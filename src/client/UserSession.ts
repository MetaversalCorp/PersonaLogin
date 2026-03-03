import { Session } from "../base/Session.js";
import { ConnectionState } from "../types/index.js";
import type { LnGUser, LnGPersona } from "../mv/LnG.js";
import { getPFabric } from "../mv/LnG.js";
import { PersonaSession } from "./PersonaSession.js";
import type { PersonaTransform } from "../avatar/PersonaPuppet.js";

/** Celestial body ID for RP1 Earth used in persona position and teleport. */
const CELESTIAL_ID_EARTH = 104;

/**
 * Starting geographic position for new personas (latitude radians, longitude radians, radius metres).
 * Matches the RP1Demo START_LOCATION_GEOPOS_NORMAL constant.
 */
const START_LOCATION_GEOPOS_NORMAL: [number, number, number] = [0.999998177182, 1.005000424655, 6371000];

/**
 * Convert a geographic position [latRad, lonRad, radius] to a Cartesian double3
 * { dX, dY, dZ } suitable for MVRP POSITION_UNIVERSAL.pRelative.vPosition.
 */
function geoPosSimpleToDouble3([lat, lon, radius]: [number, number, number]): { dX: number; dY: number; dZ: number } {
  const cosLat = Math.cos(lat);
  return {
    dX: radius * cosLat * Math.sin(lon),
    dY: radius * Math.sin(lat),
    dZ: radius * cosLat * Math.cos(lon),
  };
}

/**
 * Lazily resolved wClass for the MVSB/RMCObject source class in the metaversal/rp1 namespace.
 * Cached after first resolution to avoid repeated namespace lookups on every persona creation.
 */
let _cachedRMCObjectWClass: number | null = null;

function getRMCObjectWClass(): number {
  if (_cachedRMCObjectWClass === null) {
    _cachedRMCObjectWClass = MV.MVMF.Core.Namespace_Get('metaversal/rp1')
      .SourceClass_Get('MVSB', 'RMCObject')
      .pSource_Factory.pReference.wClass;
  }
  return _cachedRMCObjectWClass as number;
}

/**
 * Wraps the MV model action callback pattern (`model.Send(action, data, pThis, fn, param)`)
 * in a Promise. Resolves with `pIAction` on success (dwResult === 0); rejects otherwise.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function promisifyAction(model: any, action: string, requestData: Record<string, unknown>): Promise<any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new Promise<any>((resolve, reject) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    model.Send(action, requestData, null, (pIAction: any) => {
      if (pIAction.dwResult !== 0) {
        reject(new Error(`[UserSession] Action ${action} failed: result ${pIAction.dwResult}`));
      } else {
        resolve(pIAction);
      }
    }, null);
  });
}

// MV is a global namespace populated by side-effect imports in LnG.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const MV: any;

/**
 * UserSession - owns the MVRP__RUser model returned by MV LnG and coordinates
 * persona selection and session management.
 *
 * After construction, call pickPersona(id) or createPersona(firstName, lastName)
 * to enter the world with a specific persona.
 */
export class UserSession extends Session {
  readonly username: string;
  readonly userId: string;

  /** All personas associated with this account (ownPersonaList tracker). */
  readonly ownPersonaList: LnGPersona[];

  private personaSession: PersonaSession | null = null;

  // pLnG instance stored during connect(); used for pRUser lifecycle management.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private pLnG: any = null;

  // pRUser model opened during connect() and closed during disconnect().
  // Used by createPersona() to send the RPERSONA_OPEN action.
  // Type is kept as `unknown` because the private package cannot be resolved
  // in open-source builds; cast to the real type when the package is available.
  // import('@metaversalcorp/mvrp').RUser
  private pRUser: unknown = null;

  // MV.MVRP.Fabric.FRIENDS instance initialized after persona entry.
  // Type is kept as `unknown` because the private package cannot be resolved
  // in open-source builds; cast to the real type when the package is available.
  // import('@metaversalcorp/mvrp_fabric').FRIENDS
  private friendsManager: unknown = null;
  private friendsReadyListener: object | null = null;

  constructor(user: LnGUser) {
    super();
    this.username = user.displayName;
    this.userId = user.id;
    this.ownPersonaList = [...user.personas];
  }

  async connect(): Promise<void> {
    this.setState(ConnectionState.Connecting);
    this.pLnG = getPFabric()?.pLnG ?? null;
    if (this.pLnG) {
      try {
        this.pRUser = this.pLnG.Model_Open('RUser', parseInt(this.userId, 10));
      } catch (err) {
        console.error("[UserSession] Failed to open RUser model:", err);
      }
    }
    this.setState(ConnectionState.Connected);
  }

  /**
   * Select an existing persona by ID and enter the world.
   * Creates a PersonaSession and transitions state to InWorld immediately after
   * puppet spawn. Friends service initialization is optional and non-blocking;
   * it proceeds asynchronously after world entry and logs a warning if the
   * friends LnG is not available.
   */
  async pickPersona(id: string, firstName?: string, lastName?: string): Promise<void> {
    this.setState(ConnectionState.EnteringWorld);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pLnG: any = getPFabric()?.pLnG ?? null;
    this.personaSession = new PersonaSession(id, pLnG, firstName, lastName);
    await this.personaSession.connect();

    this.setState(ConnectionState.InWorld);

    // Friends service initialization is best-effort and must not block world entry.
    this._initFriendsService(id).catch((err) => {
      console.error("[UserSession] Unexpected error in friends service initialization:", err);
    });
  }

  private async _initFriendsService(personaId: string): Promise<void> {
    const pFabric = getPFabric();
    if (!pFabric) return;

    const friendsLnG = pFabric.GetLnG("friends");
    if (!friendsLnG) {
      console.warn("[UserSession] Friends service LnG not available; skipping friends initialization");
      return;
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.friendsManager = new MV.MVRP.Fabric.FRIENDS(friendsLnG, personaId);
      this.friendsReadyListener = {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onReadyState: (pNotice: any) => {
          if (pNotice.pEmitter !== this.friendsManager) return;
          if (pNotice.pEmitter.ReadyState() === pNotice.pEmitter.eSTATE.READY) {
            // Friends service is ready to use
          }
        },
      };
      (this.friendsManager as { Attach: (listener: object) => void }).Attach(
        this.friendsReadyListener
      );
    } catch (err) {
      console.error("[UserSession] Friends service initialization failed:", err);
    }
  }

  /**
   * Create a new persona on the server via the RPERSONA_OPEN action and enter
   * the world with it. Uses the real numeric persona ID (twRPersonaIx) returned
   * by the server instead of a stub ID.
   */
  async createPersona(firstName: string, lastName: string): Promise<LnGPersona> {
    const displayName = [firstName, lastName].filter(Boolean).join(" ");
    if (!this.pLnG || !this.pRUser) {
      throw new Error("[UserSession] pRUser is not available; cannot create persona");
    }
    const wClass = getRMCObjectWClass();
    const result = await promisifyAction(
      this.pRUser,
      'RPERSONA_OPEN',
      {
        twRUserIx: parseInt(this.userId, 10),
        qwMapIx_Home: 0,
        pName: { wsForename: firstName, wsSurname: lastName, dwSequence: 0 },
        pPosition: {
          pParent: {
            twObjectIx: CELESTIAL_ID_EARTH,
            wClass: wClass,
          },
          pRelative: {
            vPosition: geoPosSimpleToDouble3(START_LOCATION_GEOPOS_NORMAL),
          },
        },
      }
    );
    const rawId = result.pResponse?.twRPersonaIx;
    if (rawId == null) {
      throw new Error("[UserSession] RPERSONA_OPEN response missing twRPersonaIx");
    }
    const personaId = String(rawId);
    const persona: LnGPersona = {
      id: personaId,
      firstName,
      lastName,
      displayName,
    };
    this.ownPersonaList.push(persona);
    await this.pickPersona(persona.id, firstName, lastName);
    return persona;
  }

  /**
   * Teleport the active persona to the given world position.
   *
   * @param celestialId - The pParent celestial body identifier (e.g. 104 for RP1 Earth).
   * @param transform - Cartesian position in world-space metres (x/y/z).
   *   `rotY` is intentionally omitted and defaults to 0 on the puppet side.
   *
   * No-op when not in world.
   */
  teleportTo(celestialId: string, transform: Omit<PersonaTransform, "rotY">): void {
    this.personaSession?.teleportTo(celestialId, transform);
  }

  async disconnect(): Promise<void> {
    if (this.personaSession) {
      await this.personaSession.disconnect();
      this.personaSession = null;
    }
    if (this.friendsManager && this.friendsReadyListener) {
      (this.friendsManager as { Detach: (listener: object) => void }).Detach(
        this.friendsReadyListener
      );
    }
    this.friendsReadyListener = null;
    this.friendsManager = null;
    if (this.pRUser && this.pLnG) {
      this.pLnG.Model_Close(this.pRUser);
    }
    this.pRUser = null;
    this.pLnG = null;
    this.setState(ConnectionState.Disconnected);
  }
}
