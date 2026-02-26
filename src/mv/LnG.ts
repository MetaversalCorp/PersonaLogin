/**
 * MV LnG (Log-n-Go) authentication interface and stub client.
 *
 * The real implementation is provided by @metaversalcorp/mvmf at runtime.
 * MV LnG manages all HTTP communication with RP1 servers and handles token
 * exchange internally — applications must NOT make direct HTTP calls to the
 * login endpoint.
 *
 * Real usage (requires @metaversalcorp/mvmf at runtime):
 *   import { LnG, GUEST_EMAIL } from '@metaversalcorp/mvmf';
 *   const pLnG = new LnG();
 *   const user = await pLnG.Login(email, password, remember, finalizationHandler);
 */

/** Email constant used to initiate a guest login via LnG. */
export const GUEST_EMAIL = "guest@rp1.local";

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
 * Create an LnG client instance.
 *
 * Real implementation (requires @metaversalcorp/mvmf at runtime):
 *   import { LnG } from '@metaversalcorp/mvmf';
 *   return new LnG();
 *
 * The stub below preserves the same interface so dependent code compiles and
 * type-checks without the private package installed.
 */
export function createLnGClient(): ILnGClient {
  // Real implementation (requires @metaversalcorp/mvmf at runtime):
  // const { LnG } = await import('@metaversalcorp/mvmf');
  // return new LnG();

  return {
    async Login(
      _email: string,
      _password?: string,
      _remember?: boolean,
      _finalizationHandler?: FinalizationHandler
    ): Promise<LnGUser> {
      throw new Error(
        "MV LnG is not available: @metaversalcorp/mvmf must be present at runtime. " +
          "Install the package and replace this stub with: new LnG()"
      );
    },

    async Logout(): Promise<void> {
      // no-op in stub
    },
  };
}
