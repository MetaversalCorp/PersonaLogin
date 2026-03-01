// MV is a global namespace populated by side-effect imports in LnG.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const MV: any;

/** Email sentinel used to initiate an anonymous guest session via MV LnG. */
export const GUEST_EMAIL = "guest@rp1.com";

/** A single persona associated with a user account. */
export interface LnGPersona {
  id: string;
  firstName: string;
  lastName: string;
  displayName: string;
}

/** User data returned after a successful MV LnG login. */
export interface LnGUser {
  id: string;
  displayName: string;
  personas: LnGPersona[];
}

/** Thin TypeScript facade over the MV LnG login/logout flow. */
export interface ILnGClient {
  /**
   * Authenticate with RP1 via MV LnG.
   * @param encoded              Credentials encoded with MV.MVMF.Encode().
   * @param finalizationHandler  Called when a 2FA code is required.
   */
  Login(
    encoded: string,
    finalizationHandler?: (resolve2FA: (code: string) => void) => void
  ): Promise<LnGUser>;
  /** Sign out of the current session. */
  Logout(): Promise<void>;
}

/**
 * Returns the MSF configuration URL based on the `?backend` query parameter.
 * Any value other than "prod" (including absent) selects the dev environment.
 *   ?backend=prod  → https://cdn2.rp1.com/config/enter.msf
 *   otherwise      → https://cdn2_dev.rp1.dev/config/enter.msf
 */
function getMsfConfigUrl(): string {
  const params = new URLSearchParams(window.location.search);
  const backend = params.get("backend");
  const domain = backend === "prod" ? ".rp1.com" : "_dev.rp1.dev";
  return `https://cdn2${domain}/config/enter.msf`;
}

// Module-level MSF (MV.MVRP.MSF) instance, set by createLnGClient().
// createLnGClient() is intended to be called once per application lifetime;
// calling it again will replace the existing instance without cleanup.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pFabric: any = null;

/**
 * Returns the active MSF fabric instance, or null before createLnGClient() is called.
 * Used by UserSession.pickPersona() to access pFabric.GetLnG("friends") and
 * pFabric.Attach/Detach for the event-based friends service initialization pattern.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getPFabric(): any {
  return pFabric;
}

/**
 * Waits for the MSF fabric to reach a ready state.
 * Uses the Attach/onReadyState pattern established by MV.MVMF.NOTIFICATION.
 * Friends-service initialization is intentionally NOT performed here; it is
 * handled via pFabric.GetLnG("friends") in UserSession.pickPersona() after
 * persona selection.
 */
function ensureLnGReady(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        const READY_TIMEOUT_MS = 30_000;
        const timer = setTimeout(() => {
            pFabric.Detach(listener);
            reject(new Error("[LnG] Timed out waiting for MSF to become ready"));
        }, READY_TIMEOUT_MS);

        const listener = {
            onReadyState: () => {
                if (pFabric.IsReady()) {
                    clearTimeout(timer);
                    pFabric.Detach(listener);
                    resolve();
                }
            },
        };

        pFabric.Attach(listener);
    });
}

/**
 * Creates and returns an ILnGClient backed by a new MV.MVRP.MSF instance.
 * This is the primary entry point for MV LnG authentication in the app.
 *
 * Real authentication flow (requires MV vendor scripts at runtime):
 *   pFabric = new MV.MVRP.MSF(getMsfConfigUrl(), MV.MVRP.MSF.eMETHOD.GET, null)
 *   Login is driven by MV LnG event notifications via Attach/onReadyState.
 */
export function createLnGClient(): ILnGClient {
  pFabric = new MV.MVRP.MSF(getMsfConfigUrl(), MV.MVRP.MSF.eMETHOD.GET, null);

  return {
    async Login(
      encoded: string,
      finalizationHandler?: (resolve2FA: (code: string) => void) => void
    ): Promise<LnGUser> {
      await ensureLnGReady();

      return new Promise<LnGUser>((resolve, reject) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const loginListener: { onReadyState: (pNotice: any) => void } = {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onReadyState(pNotice: any) {
            const pLnG = pFabric.pLnG;
            if (!pLnG) {
              // pLnG has been destructed; detach to avoid leaking the listener.
              pFabric?.pLnG?.Detach(loginListener);
              return;
            }

            if (pNotice.pEmitter === pLnG) {
              const state = pLnG.ReadyState();

              if (state === pLnG.eSTATE.LOGGEDIN) {
                pLnG.Detach(loginListener);

                // Real implementation (requires @metaversalcorp/mvrp at runtime):
                //   const twUserIx = pLnG.pSession.twUserIx;
                //   const pRUser = pLnG.Model_Open('RUser', twUserIx);
                //   const personas = [...pRUser.ownPersonaList];
                //   pLnG.Model_Close(pRUser);
                const user: LnGUser = {
                  id: String(pLnG.pSession?.twUserIx ?? 0),
                  displayName: "",
                  personas: [],
                };
                resolve(user);
              } else if (state === pLnG.eSTATE.DISCONNECTED) {
                pLnG.Detach(loginListener);
                reject(new Error("[LnG] Authentication failed"));
              }
            } else if (
              finalizationHandler &&
              pNotice.pEmitter === pLnG.pSession &&
              pLnG.pSession?.ReadyState() === pLnG.pSession?.eSTATE.LOGGINGIN_AUTHENTICATE
            ) {
              finalizationHandler((code) => {
                pLnG.Login(code);
              });
            }
          },
        };

        pFabric.pLnG.Attach(loginListener);
        pFabric.pLnG.Login(encoded);
      });
    },

    async Logout(): Promise<void> {
      if (pFabric?.pLnG) {
        pFabric.pLnG.Logout();
      }
    },
  };
}