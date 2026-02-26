/**
 * RP1 server configuration and environment settings.
 */
export const Config = {
  /** Base URL for the Persona authentication server */
  AUTH_BASE_URL: "https://prod-persona.rp1.com",

  /** Member login endpoint */
  AUTH_LOGIN_PATH: "/login",

  /** Guest login endpoint */
  AUTH_GUEST_PATH: "/login/guest",

  /** Token refresh endpoint */
  AUTH_REFRESH_PATH: "/login/refresh",

  /** Request timeout in milliseconds */
  TIMEOUT_MS: 15_000,

  /** localStorage key for persisted auth token */
  TOKEN_STORAGE_KEY: "rp1_auth_token",

  /** Default persona ID used when none is provided */
  DEFAULT_PERSONA_ID: "default",
} as const;

/** Derived full endpoint URLs */
export const Endpoints = {
  login: `${Config.AUTH_BASE_URL}${Config.AUTH_LOGIN_PATH}`,
  guestLogin: `${Config.AUTH_BASE_URL}${Config.AUTH_GUEST_PATH}`,
  tokenRefresh: `${Config.AUTH_BASE_URL}${Config.AUTH_REFRESH_PATH}`,
} as const;
