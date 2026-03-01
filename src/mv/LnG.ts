// MV is a global namespace populated by side-effect imports (vendor JS bundles).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const MV: any;

import { Config } from "../config.js";

// ─── Public types ──────────────────────────────────────────────────────────────

/** Email sentinel that MV LnG recognises as an anonymous / guest session. */
export const GUEST_EMAIL = "";

/** A persona associated with a user account. */
export interface LnGPersona {
  id: string;
  firstName: string;
  lastName: string;
  displayName: string;
}

/** A logged-in (or guest) user returned by ILnGClient.Login(). */
export interface LnGUser {
  id: string;
  displayName: string;
  personas: LnGPersona[];
}

/** Thin async wrapper around the MV pLnG authentication API. */
export interface ILnGClient {
  Login(
    encoded: unknown,
    finalizationHandler?: (resolve2FA: (code: string) => void) => void
  ): Promise<LnGUser>;
  Logout(): Promise<void>;
}

// ─── MSF management ────────────────────────────────────────────────────────────

// Module-level MSF (Metaversal Service Fabric) instance, assigned by createLnGClient.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let MSF: any = null;

/**
 * Return the active MSF (Metaversal Service Fabric) instance, or null when the
 * MV runtime has not yet initialised it.
 */
export function getPFabric(): {
  Attach: (listener: object) => void;
  Detach: (listener: object) => void;
  IsReady: () => boolean;
  GetLnG: (serviceName: string) => unknown;
} | null {
  return MSF;
}

function ensureLnGReady() {
    if (!MSF) return null;

    // Detach previous services if any
    MSF.Detach();

    // Attach the required services
    MSF.Attach();

    // Check if it's ready
    if (MSF.IsReady()) {
        return MSF.GetLnG();
    }
    return null;
}

// ─── Login client factory ──────────────────────────────────────────────────────

/**
 * Create an ILnGClient that drives the MV LnG (Log-n-Go) login flow.
 *
 * The MSF instance created here is also exposed via getPFabric() so that
 * UserSession.pickPersona() can access the friends-service LnG after login.
 *
 * @param msfConfigUrl - URL of the MSF JSON configuration endpoint.
 *                       Defaults to Config.MSF_CONFIG_URL.
 */
export function createLnGClient(
  msfConfigUrl: string = Config.MSF_CONFIG_URL
): ILnGClient {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  MSF = new MV.MVRP.MSF(msfConfigUrl, MV.MVRP.MSF.eMETHOD.GET, null) as unknown;

  return {
    Login(encoded, finalizationHandler) {
      return new Promise<LnGUser>((resolve, reject) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const listener: { onReadyState: (pNotice: any) => void } = {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onReadyState: (pNotice: any) => {
            if (pNotice?.pEmitter !== MSF) return;
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
            const nState: number = MSF.ReadyState();
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            const eSTATE = MSF.eSTATE;
            if (
              // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
              nState === eSTATE.READY_LOGGEDOUT
            ) {
              // MSF is ready and logged out — initiate login now.
              // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
              const pLnG: any = MSF.pLnG;
              if (pLnG) {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
                pLnG.Login(encoded);
              }
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            } else if (nState === eSTATE.READY_LOGGEDIN) {
              MSF.Detach(listener);
              // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
              const pLnG: any = MSF.pLnG;
              // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
              const twUserIx: string = String(pLnG?.pSession?.twUserIx ?? "");
              // Open the RUser model to read persona list.
              // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
              const pRUser: any = pLnG?.Model_Open("RUser", twUserIx) ?? null;
              if (!pRUser) {
                resolve({ id: twUserIx, displayName: "", personas: [] });
                return;
              }
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const pRUserListener: { onReadyState: (n: any) => void } = {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                onReadyState: (_pNotice: any) => {
                  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
                  if (!pRUser.IsReady()) return;
                  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
                  pRUser.Detach(pRUserListener);
                  const personas: LnGPersona[] = [];
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
                  for (const pRPersona of ((pRUser.aRPersona ?? []) as any[])) {
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                    const firstName: string = pRPersona.pName?.wsForename ?? "";
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                    const lastName: string = pRPersona.pName?.wsSurname ?? "";
                    personas.push({
                      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                      id: String(pRPersona.twRPersonaIx ?? ""),
                      firstName,
                      lastName,
                      displayName: [firstName, lastName].filter(Boolean).join(" "),
                    });
                  }
                  const user: LnGUser = {
                    id: twUserIx,
                    displayName: personas[0]?.displayName ?? `user_${twUserIx}`,
                    personas,
                  };
                  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
                  pLnG.Model_Close(pRUser);
                  resolve(user);
                },
              };
              // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
              pRUser.Attach(pRUserListener);
              // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
              if (pRUser.IsReady()) {
                pRUserListener.onReadyState(null);
              }
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            } else if (nState === eSTATE.ERROR) {
              MSF.Detach(listener);
              reject(new Error("[LnG] Login failed: MSF error"));
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            } else if (nState === eSTATE.LOGGINGIN_AUTHENTICATE && finalizationHandler) {
              finalizationHandler((code) => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
                const pLnG: any = MSF?.pLnG;
                if (pLnG) {
                  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
                  pLnG.Login(`tfa=${MV.MVMF.Escape(code) as string}`);
                }
              });
            }
          },
        };

        MSF.Attach(listener);

        // If MSF is already in READY_LOGGEDOUT state, initiate login immediately.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        if (MSF.ReadyState() === MSF.eSTATE.READY_LOGGEDOUT) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
          const pLnG: any = MSF.pLnG;
          if (pLnG) {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
            pLnG.Login(encoded);
          }
        }
      });
    },

    async Logout() {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pLnG: any = MSF?.pLnG;
      if (pLnG) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
        pLnG.Logout();
      }
    },
  };
}