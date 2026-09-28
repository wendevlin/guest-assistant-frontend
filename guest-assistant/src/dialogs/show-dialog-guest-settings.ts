import { fireEvent } from "../../../src/common/dom/fire_event";

export interface GuestSettingsDialogParams {
  /** The host allows the guest to switch between auto, light and dark. */
  themeModeSelectable: boolean;
}

export const showGuestSettingsDialog = (
  element: HTMLElement,
  dialogParams: GuestSettingsDialogParams
) =>
  fireEvent(element, "show-dialog", {
    dialogTag: "dialog-guest-settings",
    dialogImport: () => import("./dialog-guest-settings"),
    dialogParams,
  });
