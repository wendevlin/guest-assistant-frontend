import { css, html, LitElement, nothing } from "lit";
import { customElement, property } from "lit/decorators";
import type { LocalizeFunc } from "../../../src/common/translations/localize";
import "../../../src/components/ha-alert";

/**
 * - `server`: the guest-assistant server cannot be reached
 * - `home-assistant`: the server is up but has no connection to HA
 * - `connection`: the connection dropped for another reason
 */
export type ConnectionProblem = "server" | "home-assistant" | "connection";

const FALLBACK: Record<ConnectionProblem, string> = {
  server: "The server is not reachable",
  "home-assistant": "The server cannot reach Home Assistant",
  connection: "Connection lost",
};

/** Bottom sheet shown while the app is reconnecting. */
@customElement("guest-assistant-connection-banner")
export class GuestAssistantConnectionBanner extends LitElement {
  @property({ attribute: false }) public localize?: LocalizeFunc;

  @property({ attribute: false }) public problem?: ConnectionProblem;

  protected render() {
    if (!this.problem) {
      return nothing;
    }
    const title =
      this.localize?.(
        `guest-assistant.connection.${this.problem.replace("-", "_")}` as any
      ) || FALLBACK[this.problem];
    const text =
      this.localize?.("guest-assistant.connection.reconnecting") ||
      "Trying to reconnect automatically…";

    return html`
      <div class="sheet" role="status" aria-live="polite">
        <ha-alert alert-type="warning" .title=${title}>${text}</ha-alert>
      </div>
    `;
  }

  static styles = css`
    :host {
      position: fixed;
      inset-inline: 0;
      bottom: 0;
      z-index: 10;
      display: flex;
      justify-content: center;
      pointer-events: none;
    }
    .sheet {
      pointer-events: auto;
      width: 100%;
      max-width: 560px;
      box-sizing: border-box;
      padding: 12px 16px calc(12px + var(--safe-area-inset-bottom, 0px));
      background: var(--card-background-color, white);
      border-top-left-radius: var(--ha-border-radius-2xl, 24px);
      border-top-right-radius: var(--ha-border-radius-2xl, 24px);
      box-shadow: var(--ha-box-shadow-l, 0 -4px 16px rgba(0, 0, 0, 0.16));
      animation: slide-up 250ms ease-out;
    }
    @media (prefers-reduced-motion: reduce) {
      .sheet {
        animation: none;
      }
    }
    @keyframes slide-up {
      from {
        transform: translateY(100%);
      }
      to {
        transform: translateY(0);
      }
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "guest-assistant-connection-banner": GuestAssistantConnectionBanner;
  }
}
