import type { NavigateOptions } from "../../../src/common/navigate";
import type { ExternalAuth } from "../../../src/external_app/external_auth";
import type { EMIncomingMessageCommands } from "../../../src/external_app/external_messaging";

/**
 * The guest page inside the Home Assistant companion app. The app loads it
 * with `?external_auth=1`, signs the guest in itself (see the proxy's
 * companion support) and hands the page its tokens over a JavaScript bridge,
 * like it does for Home Assistant's own frontend.
 */

/**
 * Whether the page runs in a companion app. Only an actual bridge counts:
 * `external_auth=1` in the URL alone (a browser) would make the external
 * auth module throw.
 */
export const hasExternalBridge = (): boolean =>
  Boolean(
    window.externalAppV2 ||
    window.externalApp ||
    window.webkit?.messageHandlers?.getExternalAuth
  );

/** Auth backed by the app, with its message bus attached (config/get sent). */
export const loadExternalAuth = async (
  hassUrl: string
): Promise<ExternalAuth> => {
  const { createExternalAuth } =
    await import("../../../src/external_app/external_auth");
  return createExternalAuth(hassUrl);
};

/** Whether `path` points into the guest's dashboard (`/<url_path>` and its views). */
export const isPathInsideDashboard = (
  path: string,
  dashboardUrlPath: string | null
): boolean => {
  const prefix = `/${dashboardUrlPath ?? "lovelace"}`;
  const pathname = path.split(/[?#]/)[0];
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
};

export interface ExternalCommandContext {
  dashboardUrlPath: string | null;
  reconnect: () => void;
  navigate: (path: string, options?: NavigateOptions) => void;
}

export type ExternalCommandResult =
  | { success: true }
  | { success: false; error: { code: string; message: string } };

/**
 * Answers a command of the app. Guests only have their dashboard: the app
 * may reconnect and navigate inside it; sidebar, notifications, the
 * automation editor and device set-up do not exist here.
 */
export const handleExternalCommand = (
  msg: EMIncomingMessageCommands,
  ctx: ExternalCommandContext
): ExternalCommandResult => {
  if (msg.command === "restart") {
    ctx.reconnect();
    return { success: true };
  }
  if (
    msg.command === "navigate" &&
    isPathInsideDashboard(msg.payload.path, ctx.dashboardUrlPath)
  ) {
    ctx.navigate(msg.payload.path, msg.payload.options);
    return { success: true };
  }
  return {
    success: false,
    error: { code: "not_allowed", message: "Not available for guests" },
  };
};
