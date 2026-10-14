import { css, html, LitElement, nothing, type PropertyValues } from "lit";
import { customElement, state } from "lit/decorators";
import "../../src/components/ha-alert";
import "../../src/components/ha-spinner";
import { haStyle } from "../../src/resources/styles";
import "./components/guest-assistant-login";
import { loginFlow } from "./data/guest-api";
import { callbackUrl, parseAuthorizeParams } from "./data/guest-authorize";
import { GuestLocalizeMixin } from "./guest-assistant-localize-mixin";

/**
 * authorize.html: the page the Home Assistant companion app opens at
 * /auth/authorize to sign a guest in. The guest signs in with the regular
 * guest login; the page then sends the app to its callback with a one-time
 * code, which the app exchanges for its tokens at the proxy.
 */
@customElement("ha-guest-assistant-authorize")
export class HaGuestAssistantAuthorize extends GuestLocalizeMixin(LitElement) {
  private _params = parseAuthorizeParams(window.location.search);

  @state() private _redirecting = false;

  protected firstUpdated(changedProps: PropertyValues): void {
    super.firstUpdated(changedProps);
    this.addEventListener("guest-language-changed", (ev) =>
      this._setLanguage((ev as CustomEvent<string>).detail)
    );
  }

  protected render() {
    if (!this.localize) {
      return nothing;
    }
    if (!this._params) {
      return html`
        <div class="centered">
          <ha-alert alert-type="error">
            ${this.localize("guest-assistant.authorize.invalid")}
          </ha-alert>
        </div>
      `;
    }
    if (this._redirecting) {
      return html`
        <div class="centered">
          <ha-spinner size="large"></ha-spinner>
        </div>
      `;
    }
    return html`
      <guest-assistant-login
        .localize=${this.localize}
        .language=${this.language}
        .signIn=${this._signIn}
      ></guest-assistant-login>
    `;
  }

  private _signIn = async (username: string, password: string) => {
    const { clientId, redirectUri, state: oauthState } = this._params!;
    const code = await loginFlow(clientId, redirectUri, username, password);
    this._redirecting = true;
    // A navigation, not a form post: the page's CSP limits form targets.
    window.location.assign(callbackUrl(redirectUri, code, oauthState));
  };

  private _setLanguage(language: string) {
    this.language = language;
    try {
      window.localStorage.setItem("selectedLanguage", JSON.stringify(language));
    } catch {
      // storage unavailable (private mode); the choice lasts for this page
    }
  }

  static styles = [
    haStyle,
    css`
      :host {
        display: block;
        height: 100%;
      }
      .centered {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        min-height: 100vh;
        padding: 16px;
        box-sizing: border-box;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "ha-guest-assistant-authorize": HaGuestAssistantAuthorize;
  }
}
