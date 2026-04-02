import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CLIENT_ROOT = path.dirname(fileURLToPath(import.meta.url));

const DASHBOARD_WEB_ASSET_FILES = Object.freeze([
  ["/assets/dashboard.css", "dashboard_web_client.css", "text/css; charset=utf-8"],
  ["/assets/dashboard_web_client_base.css", "dashboard_web_client_base.css", "text/css; charset=utf-8"],
  ["/assets/dashboard_web_client_layout.css", "dashboard_web_client_layout.css", "text/css; charset=utf-8"],
  ["/assets/dashboard_web_client_components.css", "dashboard_web_client_components.css", "text/css; charset=utf-8"],
  ["/assets/dashboard-app.mjs", "dashboard_web_client_app.mjs", "application/javascript; charset=utf-8"],
  ["/assets/dashboard-render.mjs", "dashboard_web_client_render.mjs", "application/javascript; charset=utf-8"],
  ["/assets/dashboard_web_client_render_parts.mjs", "dashboard_web_client_render_parts.mjs", "application/javascript; charset=utf-8"],
  ["/assets/dashboard_web_client_render_shell.mjs", "dashboard_web_client_render_shell.mjs", "application/javascript; charset=utf-8"],
  ["/assets/dashboard_web_client_render_views.mjs", "dashboard_web_client_render_views.mjs", "application/javascript; charset=utf-8"],
  ["/assets/dashboard-state.mjs", "dashboard_web_client_state.mjs", "application/javascript; charset=utf-8"],
  ["/assets/dashboard_web_client_state_defs.mjs", "dashboard_web_client_state_defs.mjs", "application/javascript; charset=utf-8"],
  ["/assets/dashboard_web_client_state_format.mjs", "dashboard_web_client_state_format.mjs", "application/javascript; charset=utf-8"],
  ["/assets/dashboard_web_client_state_tasks.mjs", "dashboard_web_client_state_tasks.mjs", "application/javascript; charset=utf-8"],
  ["/assets/dashboard_web_client_state_projectors.mjs", "dashboard_web_client_state_projectors.mjs", "application/javascript; charset=utf-8"],
  ["/assets/dashboard_web_client_i18n.mjs", "dashboard_web_client_i18n.mjs", "application/javascript; charset=utf-8"],
  ["/assets/dashboard_web_client_locale_labels.mjs", "dashboard_web_client_locale_labels.mjs", "application/javascript; charset=utf-8"],
]);

const DASHBOARD_WEB_ASSETS = Object.freeze(Object.fromEntries(
  DASHBOARD_WEB_ASSET_FILES.map(([pathname, fileName, contentType]) => [
    pathname,
    {
      filePath: path.join(CLIENT_ROOT, fileName),
      contentType,
    },
  ]),
));

export function readDashboardWebAsset(pathname) {
  const asset = DASHBOARD_WEB_ASSETS[pathname];
  if (!asset) {
    return null;
  }

  return {
    ...asset,
    content: fs.readFileSync(asset.filePath, "utf8"),
  };
}
