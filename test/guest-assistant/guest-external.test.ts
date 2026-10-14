import { afterEach, describe, expect, it, vi } from "vitest";
import type { EMIncomingMessageCommands } from "../../src/external_app/external_messaging";
import {
  handleExternalCommand,
  hasExternalBridge,
  isPathInsideDashboard,
} from "../../guest-assistant/src/data/guest-external";

// In the companion app the guest page takes its token from the app instead
// of a cookie. Detecting the app wrongly breaks the sign-in either way, and
// the app's commands must not lead a guest out of their dashboard.

const command = (msg: object) => msg as EMIncomingMessageCommands;

describe("hasExternalBridge", () => {
  afterEach(() => {
    delete window.externalApp;
    delete window.externalAppV2;
    delete (window as { webkit?: unknown }).webkit;
    window.history.replaceState(null, "", "/");
  });

  it("is false in a browser, also with external_auth=1 in the URL", () => {
    window.history.replaceState(null, "", "/?external_auth=1");
    expect(hasExternalBridge()).toBe(false);
  });

  it("detects the Android and iOS bridges", () => {
    window.externalApp = {
      getExternalAuth: () => undefined,
      revokeExternalAuth: () => undefined,
      externalBus: () => undefined,
    };
    expect(hasExternalBridge()).toBe(true);
    delete window.externalApp;

    window.externalAppV2 = { postMessage: () => undefined };
    expect(hasExternalBridge()).toBe(true);
    delete window.externalAppV2;

    (window as { webkit?: unknown }).webkit = {
      messageHandlers: { getExternalAuth: { postMessage: () => undefined } },
    };
    expect(hasExternalBridge()).toBe(true);
  });
});

describe("isPathInsideDashboard", () => {
  it("allows the dashboard and its views only", () => {
    expect(isPathInsideDashboard("/guest-dash", "guest-dash")).toBe(true);
    expect(
      isPathInsideDashboard("/guest-dash/kitchen?edit=1", "guest-dash")
    ).toBe(true);
    expect(isPathInsideDashboard("/lovelace/0", null)).toBe(true);
    expect(isPathInsideDashboard("/guest-dashboard", "guest-dash")).toBe(false);
    expect(isPathInsideDashboard("/config/integrations", "guest-dash")).toBe(
      false
    );
  });
});

describe("handleExternalCommand", () => {
  const ctx = () => ({
    dashboardUrlPath: "guest-dash",
    reconnect: vi.fn(),
    navigate: vi.fn(),
  });

  it("reconnects on restart", () => {
    const c = ctx();
    expect(
      handleExternalCommand(
        command({ id: 1, type: "command", command: "restart" }),
        c
      )
    ).toEqual({ success: true });
    expect(c.reconnect).toHaveBeenCalled();
  });

  it("navigates only inside the dashboard", () => {
    const c = ctx();
    const navigateTo = (path: string) =>
      handleExternalCommand(
        command({
          id: 2,
          type: "command",
          command: "navigate",
          payload: { path },
        }),
        c
      );
    expect(navigateTo("/guest-dash/terrace")).toEqual({ success: true });
    expect(c.navigate).toHaveBeenCalledWith("/guest-dash/terrace", undefined);
    expect(navigateTo("/config/dashboard").success).toBe(false);
    expect(c.navigate).toHaveBeenCalledTimes(1);
  });

  it("refuses everything else", () => {
    const c = ctx();
    for (const name of [
      "sidebar/show",
      "notifications/show",
      "automation/editor/show",
      "kiosk_mode/set",
    ]) {
      expect(
        handleExternalCommand(
          command({ id: 3, type: "command", command: name }),
          c
        )
      ).toEqual({
        success: false,
        error: { code: "not_allowed", message: "Not available for guests" },
      });
    }
    expect(c.reconnect).not.toHaveBeenCalled();
    expect(c.navigate).not.toHaveBeenCalled();
  });
});
