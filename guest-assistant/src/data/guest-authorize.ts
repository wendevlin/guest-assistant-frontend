/**
 * The authorize page (authorize.html) the companion app opens to sign a
 * guest in. The page is reachable from any browser, so it only accepts the
 * official apps and their callback, the same list the proxy checks.
 */

export const CLIENT_IDS: ReadonlySet<string> = new Set([
  "https://home-assistant.io/android",
  "https://home-assistant.io/iOS",
  "https://home-assistant.io/iOS/dev-auth",
]);

export const REDIRECT_URIS: ReadonlySet<string> = new Set([
  "homeassistant://auth-callback",
  "homeassistant-dev://auth-callback",
]);

const MAX_STATE_LENGTH = 512;

export interface AuthorizeParams {
  clientId: string;
  redirectUri: string;
  state?: string;
}

/** The sign-in request in the page's query, or null if it is not one of the apps'. */
export const parseAuthorizeParams = (
  search: string
): AuthorizeParams | null => {
  const params = new URLSearchParams(search);
  const clientId = params.get("client_id");
  const redirectUri = params.get("redirect_uri");
  const state = params.get("state") ?? undefined;
  if (
    !clientId ||
    !redirectUri ||
    !CLIENT_IDS.has(clientId) ||
    !REDIRECT_URIS.has(redirectUri) ||
    (state !== undefined && state.length > MAX_STATE_LENGTH)
  ) {
    return null;
  }
  return { clientId, redirectUri, state };
};

/** Where the page sends the app after the sign-in: the callback with the code. */
export const callbackUrl = (
  redirectUri: string,
  code: string,
  state?: string
): string => {
  const url = new URL(redirectUri);
  url.searchParams.set("code", code);
  if (state) {
    url.searchParams.set("state", state);
  }
  return url.toString();
};
