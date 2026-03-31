import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { ensureDir, fileExists, readText, writeJson } from "./common.mjs";

const REAL_PWSH_ENV = "HELLOLOOP_REAL_PWSH";
const REAL_POWERSHELL_ENV = "HELLOLOOP_REAL_POWERSHELL";
const ORIGINAL_PATH_ENV = "HELLOLOOP_ORIGINAL_PATH";
const PROXY_ENABLED_ENV = "HELLOLOOP_HIDDEN_SHELL_PROXY_ENABLED";
export const HIDDEN_PROCESS_PROXY_TARGET_ENV = "HELLOLOOP_PROXY_TARGET_EXE";
const PROXY_METADATA_FILE = "metadata.json";
const PROXY_ALIASES = ["pwsh.exe", "powershell.exe"];
const PROXY_EXECUTABLE = "HelloLoopHiddenShellProxy.exe";
const WINDOWS_SYSTEM_ROOT = process.env.SystemRoot || "C:\\Windows";
const WHERE_EXE = path.join(WINDOWS_SYSTEM_ROOT, "System32", "where.exe");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const toolRoot = path.resolve(__dirname, "..");
const proxySourceRoot = path.join(toolRoot, "native", "windows-hidden-shell-proxy");
const proxyProjectFile = path.join(proxySourceRoot, "HelloLoopHiddenShellProxy.csproj");
const proxyProgramFile = path.join(proxySourceRoot, "Program.cs");

function trimOuterQuotes(value) {
  return String(value || "").trim().replace(/^"(.*)"$/u, "$1");
}

function splitWindowsPath(value) {
  return String(value || "")
    .split(";")
    .map((item) => trimOuterQuotes(item))
    .filter(Boolean);
}

function uniqueNonEmpty(values) {
  return [...new Set(values.map((item) => trimOuterQuotes(item)).filter(Boolean))];
}

function buildWindowsPath(frontDirs, basePath) {
  return uniqueNonEmpty([
    ...frontDirs,
    ...splitWindowsPath(basePath),
  ]).join(";");
}

function parseWhereOutput(output) {
  return String(output || "")
    .split(/\r?\n/)
    .map((line) => trimOuterQuotes(line))
    .filter(Boolean);
}

function sleepSync(ms) {
  const shared = new SharedArrayBuffer(4);
  const view = new Int32Array(shared);
  Atomics.wait(view, 0, 0, Math.max(0, ms));
}

function isManagedProxyPath(candidate) {
  return String(candidate || "")
    .replaceAll("/", "\\")
    .toLowerCase()
    .includes("\\.helloloop\\runtime\\windows-hidden-shell\\");
}

function resolveShellFallbacks() {
  const programFiles = process.env.ProgramW6432 || process.env.ProgramFiles || "";
  const systemRoot = process.env.SystemRoot || "C:\\Windows";
  return {
    pwsh: [
      path.join(programFiles, "PowerShell", "7", "pwsh.exe"),
      path.join(programFiles, "PowerShell", "7-preview", "pwsh.exe"),
    ],
    powershell: [
      path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    ],
  };
}

function findExecutableInWindowsPath(executableName, lookupPath) {
  const result = spawnSync(WHERE_EXE, [executableName], {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    env: {
      ...process.env,
      PATH: lookupPath || process.env.PATH || "",
    },
  });
  if (result.status !== 0) {
    return "";
  }
  return parseWhereOutput(result.stdout).find((candidate) => !isManagedProxyPath(candidate) && fs.existsSync(candidate)) || "";
}

function resolveDotnetExecutable() {
  const candidates = uniqueNonEmpty([
    process.env.HELLOLOOP_DOTNET_EXECUTABLE,
    process.env.DOTNET_ROOT ? path.join(process.env.DOTNET_ROOT, "dotnet.exe") : "",
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, "dotnet", "dotnet.exe") : "",
    process.env["ProgramFiles(x86)"] ? path.join(process.env["ProgramFiles(x86)"], "dotnet", "dotnet.exe") : "",
    findExecutableInWindowsPath("dotnet.exe", process.env.PATH || ""),
  ]);
  return candidates.find((candidate) => fileExists(candidate)) || "";
}

function resolveRealWindowsShells(lookupPath) {
  const fallbacks = resolveShellFallbacks();
  const pwsh = findExecutableInWindowsPath("pwsh.exe", lookupPath)
    || fallbacks.pwsh.find((candidate) => fileExists(candidate))
    || "";
  const powershell = findExecutableInWindowsPath("powershell.exe", lookupPath)
    || fallbacks.powershell.find((candidate) => fileExists(candidate))
    || "";

  return {
    pwsh,
    powershell,
  };
}

function resolveSourceHash() {
  const hash = crypto.createHash("sha256");
  hash.update(readText(path.join(toolRoot, "package.json")));
  hash.update(readText(proxyProjectFile));
  hash.update(readText(proxyProgramFile));
  hash.update(process.arch);
  return hash.digest("hex").slice(0, 16);
}

function resolveRuntimeRoot() {
  return path.join(
    os.homedir(),
    ".helloloop",
    "runtime",
    "windows-hidden-shell",
    `${process.arch}-${resolveSourceHash()}`,
  );
}

function resolveProxyBinDir(runtimeRoot) {
  return path.join(runtimeRoot, "bin");
}

function resolveProxyMetadataFile(runtimeRoot) {
  return path.join(runtimeRoot, PROXY_METADATA_FILE);
}

function isProxyReady(runtimeRoot) {
  const metadataFile = resolveProxyMetadataFile(runtimeRoot);
  if (!fileExists(metadataFile)) {
    return false;
  }

  try {
    const metadata = JSON.parse(readText(metadataFile));
    if (metadata.sourceHash !== resolveSourceHash()) {
      return false;
    }
  } catch {
    return false;
  }

  const binDir = resolveProxyBinDir(runtimeRoot);
  return PROXY_ALIASES.every((fileName) => fileExists(path.join(binDir, fileName)));
}

function writeProxyMetadata(runtimeRoot, realShells, buildTool) {
  writeJson(resolveProxyMetadataFile(runtimeRoot), {
    schemaVersion: 1,
    sourceHash: resolveSourceHash(),
    builtAt: new Date().toISOString(),
    buildTool,
    realShells,
  });
}

function finalizeBuiltProxy(runtimeRoot, realShells, buildTool) {
  const binDir = resolveProxyBinDir(runtimeRoot);
  const baseExe = path.join(binDir, PROXY_EXECUTABLE);
  if (!fileExists(baseExe)) {
    throw new Error(`未生成隐藏 shell 代理可执行文件：${baseExe}`);
  }

  for (const alias of PROXY_ALIASES) {
    fs.copyFileSync(baseExe, path.join(binDir, alias));
  }

  writeProxyMetadata(runtimeRoot, realShells, buildTool);
}

function resolveDotnetSdkExecutable() {
  const dotnetExecutable = resolveDotnetExecutable();
  if (!dotnetExecutable) {
    return "";
  }
  const result = spawnSync(dotnetExecutable, ["--list-sdks"], {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  if (result.status !== 0 || !String(result.stdout || "").trim()) {
    return "";
  }
  return dotnetExecutable;
}

function buildProxyWithDotnet(runtimeRoot, realShells, dotnetExecutable) {
  ensureDir(runtimeRoot);

  const binDir = resolveProxyBinDir(runtimeRoot);
  ensureDir(binDir);

  const publish = spawnSync(dotnetExecutable, [
    "publish",
    proxyProjectFile,
    "-nologo",
    "-c",
    "Release",
    "-o",
    binDir,
  ], {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    cwd: proxySourceRoot,
  });

  if (publish.status !== 0) {
    throw new Error([
      "dotnet publish 执行失败。",
      String(publish.stdout || "").trim(),
      String(publish.stderr || "").trim(),
    ].filter(Boolean).join("\n"));
  }

  finalizeBuiltProxy(runtimeRoot, realShells, "dotnet");
}

function buildProxyWithPowerShell(runtimeRoot, realShells) {
  const compilerShell = realShells.powershell || realShells.pwsh;
  if (!compilerShell) {
    throw new Error("未找到可用于编译隐藏 shell 代理的 PowerShell。");
  }

  ensureDir(runtimeRoot);
  const binDir = resolveProxyBinDir(runtimeRoot);
  ensureDir(binDir);

  const buildScriptFile = path.join(runtimeRoot, "build-hidden-shell-proxy.ps1");
  const outputAssembly = path.join(binDir, "HelloLoopHiddenShellProxy.exe");
  const scriptContent = [
    "param(",
    "  [string]$SourcePath,",
    "  [string]$OutputAssembly",
    ")",
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -Path $SourcePath -OutputAssembly $OutputAssembly -OutputType WindowsApplication",
  ].join("\n");
  fs.writeFileSync(buildScriptFile, scriptContent, "utf8");

  const compile = spawnSync(compilerShell, [
    "-NoLogo",
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    buildScriptFile,
    "-SourcePath",
    proxyProgramFile,
    "-OutputAssembly",
    outputAssembly,
  ], {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    cwd: runtimeRoot,
  });

  if (compile.status !== 0) {
    throw new Error([
      "PowerShell Add-Type 编译隐藏 shell 代理失败。",
      String(compile.stdout || "").trim(),
      String(compile.stderr || "").trim(),
    ].filter(Boolean).join("\n"));
  }

  finalizeBuiltProxy(runtimeRoot, realShells, "powershell-add-type");
}

function buildProxy(runtimeRoot, realShells) {
  const dotnetExecutable = resolveDotnetSdkExecutable();
  if (dotnetExecutable) {
    buildProxyWithDotnet(runtimeRoot, realShells, dotnetExecutable);
    return;
  }
  buildProxyWithPowerShell(runtimeRoot, realShells);
}

function acquireBuildLock(runtimeRoot) {
  const lockDir = path.join(runtimeRoot, ".build-lock");
  ensureDir(runtimeRoot);
  try {
    fs.mkdirSync(lockDir);
    return {
      acquired: true,
      lockDir,
    };
  } catch (error) {
    if (String(error?.code || "") !== "EEXIST") {
      throw error;
    }
    return {
      acquired: false,
      lockDir,
    };
  }
}

function waitForExistingBuild(runtimeRoot) {
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    if (isProxyReady(runtimeRoot)) {
      return;
    }
    sleepSync(500);
  }
  throw new Error("等待已有 Windows 隐藏 shell 代理构建完成超时。");
}

function ensureProxyBuilt(realShells) {
  const runtimeRoot = resolveRuntimeRoot();
  if (isProxyReady(runtimeRoot)) {
    return runtimeRoot;
  }

  const lock = acquireBuildLock(runtimeRoot);
  if (!lock.acquired) {
    waitForExistingBuild(runtimeRoot);
    return runtimeRoot;
  }

  try {
    if (!isProxyReady(runtimeRoot)) {
      buildProxy(runtimeRoot, realShells);
    }
    return runtimeRoot;
  } finally {
    fs.rmSync(lock.lockDir, { recursive: true, force: true });
  }
}

function ensureProxyRuntime(options = {}) {
  const basePath = String(options.basePath || process.env.PATH || "").trim();
  const realShells = resolveRealWindowsShells(basePath);
  if (!realShells.pwsh && !realShells.powershell) {
    throw new Error("未找到真实的 pwsh.exe 或 powershell.exe，无法建立隐藏 shell 代理。");
  }

  const runtimeRoot = ensureProxyBuilt(realShells);
  const proxyBinDir = resolveProxyBinDir(runtimeRoot);
  const proxyExecutable = path.join(proxyBinDir, PROXY_EXECUTABLE);
  if (!fileExists(proxyExecutable)) {
    throw new Error(`未找到隐藏 shell 代理可执行文件：${proxyExecutable}`);
  }

  return {
    basePath,
    runtimeRoot,
    proxyBinDir,
    proxyExecutable,
    realShells,
  };
}

export function resolveWindowsHiddenProcessProxyExecutable(options = {}) {
  if ((options.platform || process.platform) !== "win32") {
    return "";
  }
  return ensureProxyRuntime(options).proxyExecutable;
}

/**
 * Resolve the Windows hidden-shell proxy environment patch used to suppress
 * background pwsh/powershell console windows for Codex child processes.
 */
export function resolveWindowsHiddenShellEnvPatch(options = {}) {
  if ((options.platform || process.platform) !== "win32") {
    return {};
  }

  const runtime = ensureProxyRuntime(options);

  return {
    [REAL_PWSH_ENV]: runtime.realShells.pwsh,
    [REAL_POWERSHELL_ENV]: runtime.realShells.powershell,
    [ORIGINAL_PATH_ENV]: runtime.basePath,
    [PROXY_ENABLED_ENV]: "1",
    PATH: buildWindowsPath([runtime.proxyBinDir], runtime.basePath),
  };
}
