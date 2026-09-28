import { fireEvent } from "../../../src/common/dom/fire_event";

export const showGuestSettingsDialog = (element: HTMLElement) =>
  fireEvent(element, "show-dialog", {
    dialogTag: "dialog-guest-settings",
    dialogImport: () => import("./dialog-guest-settings"),
    dialogParams: {},
  });
