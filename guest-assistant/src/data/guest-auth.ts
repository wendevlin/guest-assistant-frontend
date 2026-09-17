import type { Auth, AuthData } from "home-assistant-js-websocket";
import { getHassToken, signOut, type HassToken } from "./guest-api";

/**
 * `Auth` implementation for home-assistant-js-websocket backed by the
 * guest-assistant proxy. The access token is the short-lived JWT from
 * `/api/auth/hass-token`; refreshing it only requires the session cookie.
 */
export class GuestAuth implements Auth {
  public data: AuthData;

  private _expiresAt: number;

  constructor(
    private readonly _hassUrl: string,
    tokens: HassToken
  ) {
    this._expiresAt = 0;
    this.data = {
      hassUrl: _hassUrl,
      clientId: null,
      expires: 0,
      refresh_token: tokens.refresh_token,
      access_token: tokens.access_token,
      expires_in: tokens.expires_in,
    };
    this._apply(tokens);
  }

  get wsUrl(): string {
    const url = new URL(this._hassUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = "/api/websocket";
    url.search = "";
    return url.toString();
  }

  get accessToken(): string {
    return this.data.access_token;
  }

  get expired(): boolean {
    // Refresh a little early so a connect never races the expiry.
    return Date.now() >= this._expiresAt - 30_000;
  }

  async refreshAccessToken(): Promise<void> {
    this._apply(await getHassToken());
  }

  async revoke(): Promise<void> {
    await signOut();
  }

  private _apply(tokens: HassToken) {
    this._expiresAt = Date.now() + tokens.expires_in * 1000;
    this.data = {
      ...this.data,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_in: tokens.expires_in,
      expires: this._expiresAt,
    };
  }
}
