/**
 * Calls against the guest-assistant proxy. The proxy exposes a hardened
 * better-auth instance; only these endpoints are enabled there.
 */

export interface GuestSession {
  user: { id: string; name: string; username?: string };
  session: { id: string; expiresAt: string };
}

export interface HassToken {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  /** url_path of the assigned dashboard, null for the default dashboard */
  dashboard_url_path: string | null;
}

export class GuestApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    /** Reasons the proxy rejected the dashboard (403 on hass-token). */
    public readonly reasons: string[] = []
  ) {
    super(message);
  }
}

const jsonHeaders = { "content-type": "application/json" };

const request = async (path: string, init?: RequestInit): Promise<Response> =>
  fetch(path, { credentials: "same-origin", ...init });

export const getSession = async (): Promise<GuestSession | null> => {
  const res = await request("/api/auth/get-session");
  if (!res.ok) {
    return null;
  }
  // better-auth answers `null` (200) when there is no session
  const data = (await res.json()) as GuestSession | null;
  return data && data.user ? data : null;
};

export const signIn = async (
  username: string,
  password: string
): Promise<void> => {
  const res = await request("/api/auth/sign-in/username", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    throw new GuestApiError(res.status, "Sign in failed");
  }
};

export const signOut = async (): Promise<void> => {
  await request("/api/auth/sign-out", {
    method: "POST",
    headers: jsonHeaders,
    body: "{}",
  });
};

export const getHassToken = async (): Promise<HassToken> => {
  const res = await request("/api/auth/hass-token");
  if (res.ok) {
    return (await res.json()) as HassToken;
  }
  let reasons: string[] = [];
  try {
    const body = (await res.json()) as { reason?: string[] };
    if (Array.isArray(body.reason)) {
      reasons = body.reason;
    }
  } catch {
    // no JSON body
  }
  throw new GuestApiError(res.status, "Could not obtain a token", reasons);
};

export interface ProxyStatus {
  home_assistant: "connected" | "disconnected";
}

/** Whether the proxy itself is reachable and connected to Home Assistant. */
export const getProxyStatus = async (): Promise<ProxyStatus | null> => {
  try {
    const res = await request("/api/guest-assistant/status", {
      cache: "no-store",
    });
    return res.ok ? ((await res.json()) as ProxyStatus) : null;
  } catch {
    return null;
  }
};
