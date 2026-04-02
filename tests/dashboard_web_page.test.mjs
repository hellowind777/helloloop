import assert from "node:assert/strict";
import test from "node:test";

import { readDashboardWebAsset } from "../src/dashboard_web_client.mjs";
import { renderDashboardWebHtml } from "../src/dashboard_web_page.mjs";

test("renderDashboardWebHtml renders the Ops Center app shell", () => {
  const html = renderDashboardWebHtml({
    initialSnapshot: {
      generatedAt: "2026-04-01T00:00:00.000Z",
      repoCount: 1,
      activeCount: 1,
      taskTotals: { total: 3, pending: 1, inProgress: 1, done: 1, blocked: 0, failed: 0 },
      sessions: [],
    },
  });

  assert.match(html, /HelloLoop Ops Center/u);
  assert.match(html, /<main id="app" class="app-host"><\/main>/u);
  assert.match(html, /id="drawer-backdrop"/u);
  assert.match(html, /href="\/assets\/dashboard\.css"/u);
  assert.match(html, /src="\/assets\/dashboard-app\.mjs"/u);
  assert.match(html, /__HELLOLOOP_INITIAL_SNAPSHOT__/u);
});

test("dashboard web assets are served from the new static module pipeline", () => {
  const cssAsset = readDashboardWebAsset("/assets/dashboard.css");
  const appAsset = readDashboardWebAsset("/assets/dashboard-app.mjs");
  const renderAsset = readDashboardWebAsset("/assets/dashboard-render.mjs");
  const stateAsset = readDashboardWebAsset("/assets/dashboard-state.mjs");
  const layoutAsset = readDashboardWebAsset("/assets/dashboard_web_client_layout.css");
  const i18nAsset = readDashboardWebAsset("/assets/dashboard_web_client_i18n.mjs");
  const renderPartsAsset = readDashboardWebAsset("/assets/dashboard_web_client_render_parts.mjs");

  assert.equal(Boolean(cssAsset?.content?.includes("@import url(\"/assets/dashboard_web_client_layout.css\")")), true);
  assert.equal(Boolean(appAsset?.content?.includes("connectEvents")), true);
  assert.equal(Boolean(renderAsset?.content?.includes("renderApp")), true);
  assert.equal(Boolean(stateAsset?.content?.includes("buildGlobalQueues")), true);
  assert.equal(Boolean(layoutAsset?.content?.includes(".ops-layout")), true);
  assert.equal(Boolean(i18nAsset?.content?.includes("shell.title")), true);
  assert.equal(Boolean(renderPartsAsset?.content?.includes("renderTaskCard")), true);
});
