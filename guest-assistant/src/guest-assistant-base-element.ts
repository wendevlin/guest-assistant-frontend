import type { PropertyValues } from "lit";
import { property, state } from "lit/decorators";
import {
  computeLocalize,
  type LocalizeFunc,
} from "../../src/common/translations/localize";
import { computeDirectionStyles } from "../../src/common/util/compute_rtl";
import { translationMetadata } from "../../src/resources/translations-metadata";
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
import type { Constructor, Resources } from "../../src/types";
import {
  getLocalLanguage,
  getTranslation,
} from "../../src/util/common-translation";

const ext = <T extends Constructor>(baseClass: T, mixins): T =>
  mixins.reduceRight((base, mixin) => mixin(base), baseClass);

/**
 * Base element for the guest app: the subset of the HA app mixins a guest
 * dashboard needs, in the same order as `HassElement`. Translations (incl.
 * backend translations for entity states and service errors), state
 * formatting and toasts come from the regular HA mixins once connected.
 *
 * Before a connection exists (login screen) there is no `hass`, so this
 * element keeps its own `localize` for the selected language. The
 * guest-assistant translation fragment ships the base strings, the lovelace
 * panel strings and the `guest-assistant.*` strings in one file, so a single
 * `getTranslation(null, language)` covers everything.
 */
export class GuestAssistantBaseElement extends ext(HassBaseEl, [
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
]) {
  /** Localize for the screens shown before `hass` exists. */
  @property({ attribute: false }) public localize?: LocalizeFunc;

  @property() public language: string = getLocalLanguage();

  @state() private _resources?: Resources;

  public connectedCallback(): void {
    super.connectedCallback();
    this._initializeLocalize();
  }

  protected willUpdate(changedProperties: PropertyValues) {
    super.willUpdate(changedProperties);

    if (changedProperties.get("language")) {
      this._resources = undefined;
      this._initializeLocalize();
    }

    if (
      this.language &&
      this._resources &&
      (changedProperties.has("language") || changedProperties.has("_resources"))
    ) {
      this._setLocalize();
    }
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

  private async _initializeLocalize() {
    if (this._resources || !this.language) {
      return;
    }
    const language = this.language;
    const { data } = await getTranslation(null, language);
    if (language === this.language) {
      this._resources = { [language]: data };
    }
  }

  private async _setLocalize() {
    const language = this.language;
    const localize = await computeLocalize(
      this.constructor.prototype,
      language,
      this._resources!
    );
    if (language !== this.language) {
      return;
    }
    this.localize = localize;
    document.querySelector("html")!.setAttribute("lang", language);
    computeDirectionStyles(
      translationMetadata.translations[language]?.isRTL ?? false,
      this
    );
  }
}
