export function shouldPromptForEngineSelection(options = {}) {
  if (options.yes) {
    return false;
  }
  if (options.detach) {
    return false;
  }
  if (process.env.HELLOLOOP_SUPERVISOR_ACTIVE === "1") {
    return false;
  }
  return Boolean(process.stdout?.isTTY);
}
