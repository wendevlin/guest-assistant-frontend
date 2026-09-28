import { mdiCog, mdiLogout } from "@mdi/js";
import { css, html, LitElement } from "lit";
import { customElement, property } from "lit/decorators";
import memoizeOne from "memoize-one";
import { fireEvent } from "../../../src/common/dom/fire_event";
import { showConfirmationDialog } from "../../../src/dialogs/generic/show-dialog-box";
import "../../../src/layouts/hass-loading-screen";
import "../../../src/panels/lovelace/ha-panel-lovelace";
import type { ExtraActionItem } from "../../../src/panels/lovelace/hui-root";
import { haStyle } from "../../../src/resources/styles";
import type { HomeAssistant, PanelInfo, Route } from "../../../src/types";
import { showGuestSettingsDialog } from "../dialogs/show-dialog-guest-settings";

/**
 * Renders the guest's dashboard with the regular lovelace panel. The proxy
 * pins `lovelace/config` to the assigned dashboard, so the panel info here
 * only needs the matching url_path.
 */
@customElement("guest-assistant-dashboard")
export class GuestAssistantDashboard extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @property({ type: Boolean }) public narrow = false;

  @property({ attribute: false }) public route: Route = {
    prefix: "/lovelace",
    path: "",
  };

  @property({ attribute: false }) public dashboardUrlPath: string | null = null;

  private _panel = memoizeOne(
    (urlPath: string | null): PanelInfo<{ mode: "storage" }> => ({
      component_name: "lovelace",
      icon: "mdi:view-dashboard",
      title: null,
      url_path: urlPath ?? "lovelace",
      config: { mode: "storage" },
      config_panel_domain: undefined,
    })
  );

  private _actions: ExtraActionItem[] = [
    {
      icon: mdiCog,
      labelKey: "ui.dialogs.more_info_control.settings",
      action: () => showGuestSettingsDialog(this),
    },
    {
      icon: mdiLogout,
      labelKey: "ui.panel.profile.logout",
      action: () => this._confirmLogout(),
    },
  ];

  protected render() {
    // Cards read config/themes through lit context; wait until both exist.
    if (!this.hass?.config || !this.hass.themes) {
      return html`
        <hass-loading-screen
          .hass=${this.hass}
          .narrow=${this.narrow}
          no-toolbar
        ></hass-loading-screen>
      `;
    }

    return html`
      <ha-panel-lovelace
        .hass=${this.hass}
        .narrow=${this.narrow}
        .route=${this.route}
        .panel=${this._panel(this.dashboardUrlPath)}
        .extraActionItems=${this._actions}
      ></ha-panel-lovelace>
    `;
  }

  private async _confirmLogout() {
    const confirmed = await showConfirmationDialog(this, {
      title: this.hass!.localize("ui.panel.profile.logout_title"),
      text: this.hass!.localize("ui.panel.profile.logout_text"),
      confirmText: this.hass!.localize("ui.panel.profile.logout"),
      destructive: true,
    });
    if (confirmed) {
      fireEvent(this, "guest-logout");
    }
  }

  static styles = [
    haStyle,
    css`
      :host,
      ha-panel-lovelace,
      hass-loading-screen {
        display: block;
        height: 100%;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "guest-assistant-dashboard": GuestAssistantDashboard;
  }
}
