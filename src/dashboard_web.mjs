import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ensureDir,
  fileExists,
  nowIso,
  readJson,
  sleep,
  tailText,
  writeJson,
} from "./common.mjs";
import { readDashboardWebAsset } from "./dashboard_web_client.mjs";
import { collectDashboardSnapshot, buildDashboardSnapshotSignature } from "./dashboard_command.mjs";
import { renderDashboardWebHtml } from "./dashboard_web_page.mjs";
import { resolveUserSettingsHome } from "./engine_selection_settings.mjs";
import { spawnNodeProcess } from "./node_process_launch.mjs";

const DEFAULT_BIND = "127.0.0.1";
const DEFAULT_PORT = 3210;
const WEB_SERVER_ENV = "HELLOLOOP_WEB_SERVER_ACTIVE";
const BUNDLE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function dashboardRuntimeRoot() {
  return path.join(resolveUserSettingsHome(), "runtime", "web-dashboard");
}

function dashboardRuntimeFiles() {
  const root = dashboardRuntimeRoot();
  ensureDir(root);
  return {
    root,
    stateFile: path.join(root, "server.json"),
    stdoutFile: path.join(root, "server-stdout.log"),
    stderrFile: path.join(root, "server-stderr.log"),
  };
}

function readJsonIfExists(filePath) {
  try {
    return filePath && fileExists(filePath) ? readJson(filePath) : null;
  } catch {
    return null;
  }
}

function isPidAlive(pid) {
  const value = Number(pid || 0);
  if (!Number.isFinite(value) || value <= 0) {
    return false;
  }
  try {
    process.kill(value, 0);
    return true;
  } catch (error) {
    return String(error?.code || "") === "EPERM";
  }
}

function normalizeBind(value) {
  const bind = String(value || "").trim();
  return bind || DEFAULT_BIND;
}

function normalizePort(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
    return DEFAULT_PORT;
  }
  return parsed;
}

function writeWebServerState(patch) {
  const files = dashboardRuntimeFiles();
  const current = readJsonIfExists(files.stateFile) || {};
  writeJson(files.stateFile, {
    ...current,
    ...patch,
    updatedAt: nowIso(),
  });
}

function readWebServerState() {
  const files = dashboardRuntimeFiles();
  const state = readJsonIfExists(files.stateFile);
  if (!state) {
    return null;
  }
  if (!isPidAlive(state.pid)) {
    try {
      fs.rmSync(files.stateFile, { force: true });
    } catch {
      // ignore stale state cleanup failure
    }
    return null;
  }
  return state;
}

function removeWebServerStateIfOwned(pid) {
  const files = dashboardRuntimeFiles();
  const state = readJsonIfExists(files.stateFile);
  if (state?.pid === pid) {
    try {
      fs.rmSync(files.stateFile, { force: true });
    } catch {
      // ignore cleanup failure
    }
  }
}

function buildWebUrl(bind, port) {
  return `http://${bind}:${port}`;
}

function renderStartSummary(state) {
  return [
    "HelloLoop Web Dashboard 已启动",
    `- 地址：${state.url}`,
    `- PID：${state.pid}`,
    `- 监听：${state.bind}:${state.port}`,
  ].join("\n");
}

function renderExistingSummary(state) {
  return [
    "HelloLoop Web Dashboard 已在运行",
    `- 地址：${state.url}`,
    `- PID：${state.pid}`,
  ].join("\n");
}

async function waitForWebServerLaunch(launchId, timeoutMs = 8000) {
  const files = dashboardRuntimeFiles();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = readJsonIfExists(files.stateFile);
    if (state?.launchId === launchId && isPidAlive(state.pid)) {
      return state;
    }
    await sleep(150);
  }
  const stderr = fileExists(files.stderrFile) ? fs.readFileSync(files.stderrFile, "utf8") : "";
  throw new Error(tailText(stderr, 40) || "HelloLoop Web Dashboard 启动超时。");
}

async function stopWebDashboardServer() {
  const state = readWebServerState();
  if (!state) {
    console.log("HelloLoop Web Dashboard 当前未运行。");
    return 0;
  }

  try {
    process.kill(state.pid);
  } catch {
    // ignore if already down
  }

  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (!isPidAlive(state.pid)) {
      removeWebServerStateIfOwned(state.pid);
      console.log(`HelloLoop Web Dashboard 已停止：${state.url}`);
      return 0;
    }
    await sleep(150);
  }

  throw new Error(`HelloLoop Web Dashboard 停止超时：pid=${state.pid}`);
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(`${JSON.stringify(payload, null, 2)}\n`);
}

function writeSseEvent(response, eventName, payload) {
  if (eventName) {
    response.write(`event: ${eventName}\n`);
  }
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function createSseClient(response, snapshot, options = {}) {
  let previousSignature = "";
  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
  writeSseEvent(response, "", snapshot);
  writeSseEvent(response, "heartbeat", {
    polledAt: nowIso(),
    generatedAt: snapshot.generatedAt || "",
    pollMs: Math.max(500, Number(options.pollMs || 1500)),
  });
  previousSignature = buildDashboardSnapshotSignature(snapshot);
  return {
    push(nextSnapshot) {
      const nextSignature = buildDashboardSnapshotSignature(nextSnapshot);
      if (nextSignature === previousSignature) {
        return;
      }
      previousSignature = nextSignature;
      writeSseEvent(response, "", nextSnapshot);
    },
    heartbeat(payload) {
      writeSseEvent(response, "heartbeat", payload);
    },
  };
}

async function startWebDashboardServer(options = {}) {
  const files = dashboardRuntimeFiles();
  const bind = normalizeBind(options.bind);
  const preferredPort = normalizePort(options.port);
  const pollMs = Math.max(500, Number(options.pollMs || options.watchPollMs || 1500));
  const initialSnapshot = collectDashboardSnapshot();
  const clients = new Set();
  let lastSnapshot = initialSnapshot;

  const server = http.createServer((request, response) => {
    const url = new URL(request.url || "/", buildWebUrl(bind, preferredPort));
    const asset = readDashboardWebAsset(url.pathname);
    if (asset) {
      response.writeHead(200, {
        "Content-Type": asset.contentType,
        "Cache-Control": "no-store",
      });
      response.end(asset.content);
      return;
    }
    if (url.pathname === "/api/snapshot") {
      sendJson(response, 200, collectDashboardSnapshot());
      return;
    }
    if (url.pathname === "/events") {
      const client = createSseClient(response, lastSnapshot, { pollMs });
      clients.add(client);
      request.on("close", () => clients.delete(client));
      return;
    }
    if (url.pathname === "/healthz") {
      sendJson(response, 200, { ok: true, generatedAt: nowIso() });
      return;
    }
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(renderDashboardWebHtml({
      initialSnapshot: lastSnapshot,
    }));
  });

  let settledPort = preferredPort;
  await new Promise((resolve, reject) => {
    const onError = (error) => {
      if (String(error?.code || "") === "EADDRINUSE" && !options.port) {
        server.off("error", onError);
        server.listen(0, bind, resolve);
        return;
      }
      reject(error);
    };
    server.once("error", onError);
    server.listen(preferredPort, bind, resolve);
  });
  const address = server.address();
  settledPort = Number(address?.port || preferredPort);
  const state = {
    pid: process.pid,
    bind,
    port: settledPort,
    url: buildWebUrl(bind, settledPort),
    startedAt: nowIso(),
    launchId: String(options.launchId || "").trim(),
    pollMs,
  };
  writeWebServerState(state);

  const timer = setInterval(() => {
    lastSnapshot = collectDashboardSnapshot();
    const heartbeat = {
      polledAt: nowIso(),
      generatedAt: lastSnapshot.generatedAt || "",
      pollMs,
    };
    writeWebServerState({
      ...state,
      generatedAt: lastSnapshot.generatedAt,
      heartbeatAt: heartbeat.polledAt,
    });
    for (const client of clients) {
      client.heartbeat(heartbeat);
      client.push(lastSnapshot);
    }
  }, pollMs);

  const shutdown = () => {
    clearInterval(timer);
    server.close(() => {
      removeWebServerStateIfOwned(process.pid);
      process.exit(0);
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  console.log(renderStartSummary({
    ...state,
    url: buildWebUrl(bind, settledPort),
  }));
}

async function launchWebDashboardServer(options = {}) {
  const existing = readWebServerState();
  if (existing) {
    console.log(renderExistingSummary(existing));
    return 0;
  }

  const files = dashboardRuntimeFiles();
  const launchId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const stdoutFd = fs.openSync(files.stdoutFile, "w");
  const stderrFd = fs.openSync(files.stderrFile, "w");

  try {
    const args = [
      path.join(BUNDLE_ROOT, "bin", "helloloop.js"),
      "__web-server",
      "--bind",
      normalizeBind(options.bind),
      "--launch-id",
      launchId,
      "--poll-ms",
      String(Math.max(500, Number(options.pollMs || options.watchPollMs || 1500))),
    ];
    if (options.port !== undefined && options.port !== null && options.port !== "") {
      args.push("--port", String(options.port));
    }

    const child = spawnNodeProcess({
      args,
      cwd: process.cwd(),
      detached: true,
      stdio: ["ignore", stdoutFd, stderrFd],
      env: {
        [WEB_SERVER_ENV]: "1",
      },
    });
    child.unref();
  } finally {
    fs.closeSync(stdoutFd);
    fs.closeSync(stderrFd);
  }

  const state = await waitForWebServerLaunch(launchId);
  console.log(renderStartSummary(state));
  return 0;
}

export async function runDashboardWebCommand(options = {}) {
  if (options.stop === true) {
    return stopWebDashboardServer();
  }
  const existing = readWebServerState();
  if (existing) {
    console.log(renderExistingSummary(existing));
    return 0;
  }
  if (options.foreground === true || process.env[WEB_SERVER_ENV] === "1") {
    await startWebDashboardServer(options);
    return 0;
  }
  return launchWebDashboardServer(options);
}
