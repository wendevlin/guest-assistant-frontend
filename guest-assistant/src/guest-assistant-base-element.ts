import type { PropertyValues } from "lit";
import ActionMixin from "../../src/state/action-mixin";
import { connectionMixin } from "../../src/state/connection-mixin";
import { contextMixin } from "../../src/state/context-mixin";
import { dialogManagerMixin } from "../../src/state/dialog-manager-mixin";
import { HassBaseEl } from "../../src/state/hass-base-mixin";
import MoreInfoMixin from "../../src/state/more-info-mixin";
import NotificationMixin from "../../src/state/notification-mixin";
import StateDisplayMixin from "../../src/state/state-display-mixin";
import themesMixin from "../../src/state/themes-mixin";
import TranslationsMixin from "../../src/state/translations-mixin";
import type { Constructor } from "../../src/types";
import { GuestLocalizeMixin } from "./guest-assistant-localize-mixin";

const ext = <T extends Constructor>(baseClass: T, mixins): T =>
  mixins.reduceRight((base, mixin) => mixin(base), baseClass);

/**
 * Base element for the guest app: the subset of the HA app mixins a guest
 * dashboard needs, in the same order as `HassElement`. Translations (incl.
 * backend translations for entity states and service errors), state
 * formatting and toasts come from the regular HA mixins once connected.
 *
 * Before a connection exists (login screen) there is no `hass`, so this
 * element keeps its own `localize` for the selected language
 * (GuestLocalizeMixin).
 */
export class GuestAssistantBaseElement extends GuestLocalizeMixin(
  ext(HassBaseEl, [
    themesMixin,
    TranslationsMixin,
    StateDisplayMixin,
    MoreInfoMixin,
    // Card taps (more-info, toggle, navigate, perform-action) arrive as
    // hass-action events and are only handled by this mixin.
    ActionMixin,
    connectionMixin,
    NotificationMixin,
    dialogManagerMixin,
    contextMixin,
  ])
) {
  protected hassConnected() {
    super.hassConnected();
    // Like home-assistant.ts: entity states ("On", "Off") and entity names
    // come from these backend translations.
    // @ts-ignore private in TranslationsMixin
    this._loadHassTranslations(this.hass!.language, "entity_component");
    // @ts-ignore private in TranslationsMixin
    this._loadHassTranslations(this.hass!.language, "entity");
  }

  protected updated(changedProperties: PropertyValues) {
    super.updated(changedProperties);
    // Like home-assistant.ts: pushes every new hass to the dialogs registered
    // via provideHass (more-info etc.); without it they keep the hass object
    // from when they were first opened.
    if (changedProperties.has("hass") && this.hass) {
      this.hassChanged(this.hass, changedProperties.get("hass"));
    }
  }
}
