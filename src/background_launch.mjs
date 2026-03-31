import fs from "node:fs";
import path from "node:path";

import { ensureDir, timestampForFile } from "./common.mjs";
import { createContext } from "./context.mjs";
import { spawnNodeProcess } from "./node_process_launch.mjs";

export const HELLOLOOP_BACKGROUND_LAUNCH_ENV = "HELLOLOOP_BACKGROUND_LAUNCH_ACTIVE";

function isDetachedAnalyzeCommand(command, options = {}) {
  return command === "analyze"
    && options.detach === true
    && options.yes === true
    && options.watch !== true;
}

export function shouldUseDetachedBackgroundLaunch(command, options = {}) {
  return process.platform === "win32"
    && process.env.HELLOLOOP_SUPERVISOR_ACTIVE !== "1"
    && process.env[HELLOLOOP_BACKGROUND_LAUNCH_ENV] !== "1"
    && isDetachedAnalyzeCommand(command, options);
}

function resolveLaunchFiles(options = {}) {
  const context = createContext({
    repoRoot: options.repoRoot || process.cwd(),
    configDirName: options.configDirName,
  });
  const launcherRoot = path.join(context.configRoot, "launcher");
  ensureDir(launcherRoot);

  const stamp = timestampForFile();
  return {
    launcherRoot,
    stdoutFile: path.join(launcherRoot, `${stamp}-analyze-stdout.log`),
    stderrFile: path.join(launcherRoot, `${stamp}-analyze-stderr.log`),
  };
}

export function launchDetachedBackgroundCli(argv, options = {}) {
  const context = createContext({
    repoRoot: options.repoRoot || process.cwd(),
    configDirName: options.configDirName,
  });
  const files = resolveLaunchFiles(options);
  const stdoutFd = fs.openSync(files.stdoutFile, "w");
  const stderrFd = fs.openSync(files.stderrFile, "w");

  try {
    const child = spawnNodeProcess({
      args: [
        path.join(context.bundleRoot, "bin", "helloloop.js"),
        ...argv,
      ],
      cwd: process.cwd(),
      detached: true,
      stdio: ["ignore", stdoutFd, stderrFd],
      env: {
        [HELLOLOOP_BACKGROUND_LAUNCH_ENV]: "1",
      },
    });
    child.unref();
    return {
      pid: child.pid ?? 0,
      stdoutFile: files.stdoutFile,
      stderrFile: files.stderrFile,
      launcherRoot: files.launcherRoot,
    };
  } finally {
    fs.closeSync(stdoutFd);
    fs.closeSync(stderrFd);
  }
}
