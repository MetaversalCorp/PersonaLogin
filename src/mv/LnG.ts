/**
 * MV LnG (Log-n-Go) authentication wrapper.
 *
 * Uses MSF (Metaversal Service Fabric) from MV.MVRP to initialize and obtain
 * the LnG client, following the RP1Demo MV library pattern.
 *
 * Environment detection: checks URL for `?backend=dev` to select the dev CDN.
 *   Production MSF: https://cdn2.rp1.com/config/enter.msf
 *   Development MSF: https://cdn2.rp1.dev/config/enter.msf
 */

import "@metaversalcorp/mvmf";
import "@metaversalcorp/mvrp";
import "@metaversalcorp/mvrp_fabric";
import "@metaversalcorp/mvrp_map";
import "@metaversalcorp/mvxp";
import "@metaversalcorp/mvio";

// MV libraries are global singletons — imports above populate the MV namespace as a side effect.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const MV: any;

/** Email constant used to initiate a guest login via LnG. */
export const GUEST_EMAIL = "guest@rp1.com";

/** A persona record returned by the LnG user object. */
export interface LnGPersona {
  id: string;
  firstName: string;
  lastName: string;
  displayName: string;
}

/** Authenticated user record owned by a UserSession after a successful LnG login. */
export interface LnGUser {
  /** Server-assigned unique identifier (MVRP__RUser id). */
  id: string;
  email: string;
  displayName: string;
  /** All personas associated with this account. */
  personas: LnGPersona[];
}

/**
 * Callback provided to `ILnGClient.Login()` that is invoked when RP1 requires
 * a two-factor authentication code.  The implementation should prompt the user
 * and then call `resolve2FA` with the entered code.
 */
export type FinalizationHandler = (resolve2FA: (code: string) => void) => void;

/** Minimal interface for the MV LnG authentication client. */
export interface ILnGClient {
  /**
   * Authenticate with RP1.
   *
   * Credentials must be encoded with MV.MVMF.Encode() before being passed in.
   * For member login: MV.MVMF.Encode({ contact, password, remember })
   * For guest login:  MV.MVMF.Encode({ contact: GUEST_EMAIL })
   *
   * Real implementation: pLnG.Login(encodedCredentials, finalizationHandler)
   */
  Login(
    encodedCredentials: unknown,
    finalizationHandler?: FinalizationHandler
  ): Promise<LnGUser>;

  /** End the current LnG session. */
  Logout(): Promise<void>;
}

/**
 * Create an LnG client instance backed by real @metaversalcorp/mvmf.
 *
 * MSF configuration is loaded from the appropriate CDN on first use:
 *   Production: https://cdn2.rp1.com/config/enter.msf
 *   Development: https://cdn2.rp1.dev/config/enter.msf  (when ?backend=dev)
 *
 * Falls back to an error-throwing stub when @metaversalcorp/mvmf is unavailable.
 * Initialization is performed lazily on the first Login() or Logout() call (singleton).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _pLnG: any = null;
let _msfReady: Promise<void> | null = null;

function ensureLnGReady(): Promise<void> {
  if (!_msfReady) {
    _msfReady = new Promise<void>((resolve, reject) => {
      try {
        const msfUrl = getMsfConfigUrl();
        const pFabric = new MV.MVRP.MSF(msfUrl, MV.MVRP.MSF.eMETHOD.GET);
        const listener = {
          onReadyState: () => {
            if (pFabric.IsReady()) {
              try {
                _pLnG = pFabric.pLnG;
                pFabric.Detach(listener);
                resolve();
              } catch (err) {
                pFabric.Detach(listener);
                reject(err);
              }
            }
          },
        };
        pFabric.Attach(listener);
      } catch (err) {
        console.error("MV LnG init failed:", err);
        reject(err);
      }
    });
  }
  return _msfReady;
}

export function createLnGClient(): ILnGClient {
  return {
    async Login(
      encodedCredentials: unknown,
      finalizationHandler?: FinalizationHandler
    ): Promise<LnGUser> {
      await ensureLnGReady();
      if (!_pLnG) {
        throw new Error(
          "MV LnG is not available: @metaversalcorp/mvmf must be present at runtime"
        );
      }
      return _pLnG.Login(encodedCredentials, finalizationHandler);
    },

    async Logout(): Promise<void> {
      await ensureLnGReady();
      if (_pLnG) {
        await _pLnG.Logout();
      }
    },
  };
}

/** Returns true when the `?backend=dev` query parameter is present in the page URL. */
export function isDevEnvironment(): boolean {
  try {
    return new URLSearchParams(window.location.search).get("backend") === "dev";
  } catch {
    return false;
  }
}

/** Returns the MSF configuration URL for the current environment. */
export function getMsfConfigUrl(): string {
  return isDevEnvironment()
    ? "https://cdn2.rp1.dev/config/enter.msf"
    : "https://cdn2.rp1.com/config/enter.msf";
}
