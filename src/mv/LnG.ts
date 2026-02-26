/**
 * MV LnG (Log-n-Go) authentication wrapper.
 *
 * Loads MSF (Metaversal Service Fabric) configuration from the appropriate CDN
 * and initializes the real LnG client from @metaversalcorp/mvmf.
 *
 * Environment detection: checks URL for `?backend=dev` to select the dev CDN.
 *   Production MSF: https://cdn2.rp1.com/config/enter.msf
 *   Development MSF: https://cdn2.rp1.dev/config/enter.msf
 */

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
   * For member login supply email + password.
   * For guest login supply only GUEST_EMAIL (password omitted).
   *
   * Real implementation: pLnG.Login(email, password, remember, finalizationHandler)
   */
  Login(
    email: string,
    password?: string,
    remember?: boolean,
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
 * Initialization is performed once at module load time (singleton).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _pLnG: any = null;

const _initPromise: Promise<void> = (async () => {
  try {
    // Use a variable so TypeScript does not statically resolve the private package.
    const pkg = "@metaversalcorp/mvmf";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mvmf: any = await import(pkg);
    const msfUrl = getMsfConfigUrl();
    const msf = new mvmf.MSF(msfUrl);
    await msf.ready();
    _pLnG = new mvmf.LnG(msf);
  } catch (err) {
    // Package not installed or MSF init failed; Login() will throw a clear error.
    console.error("MV LnG init failed:", err);
  }
})();

export function createLnGClient(): ILnGClient {
  return {
    async Login(
      email: string,
      password?: string,
      remember?: boolean,
      finalizationHandler?: FinalizationHandler
    ): Promise<LnGUser> {
      await _initPromise;
      if (!_pLnG) {
        throw new Error(
          "MV LnG is not available: @metaversalcorp/mvmf must be present at runtime"
        );
      }
      return _pLnG.Login(email, password, remember, finalizationHandler);
    },

    async Logout(): Promise<void> {
      await _initPromise;
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
