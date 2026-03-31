import { spawn } from "node:child_process";

import {
  HIDDEN_PROCESS_PROXY_TARGET_ENV,
  resolveWindowsHiddenProcessProxyExecutable,
} from "./windows_hidden_shell_proxy.mjs";

export function spawnNodeProcess(options = {}) {
  const useWindowsHiddenProxy = process.platform === "win32";
  const command = useWindowsHiddenProxy
    ? resolveWindowsHiddenProcessProxyExecutable()
    : process.execPath;

  return spawn(command, Array.isArray(options.args) ? options.args : [], {
    cwd: options.cwd || process.cwd(),
    detached: options.detached === true,
    shell: false,
    windowsHide: true,
    stdio: options.stdio || "pipe",
    env: {
      ...process.env,
      ...(options.env || {}),
      ...(useWindowsHiddenProxy
        ? { [HIDDEN_PROCESS_PROXY_TARGET_ENV]: process.execPath }
        : {}),
    },
  });
}
