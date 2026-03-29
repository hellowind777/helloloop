import { createContext } from "./context.mjs";
import { resolveRepoRoot } from "./discovery.mjs";

export function resolveContextFromOptions(options) {
  const resolvedRepo = resolveRepoRoot({
    cwd: process.cwd(),
    repoRoot: options.repoRoot,
    inputPath: options.inputPath,
  });

  if (!resolvedRepo.ok) {
    throw new Error(resolvedRepo.message);
  }

  return createContext({
    repoRoot: resolvedRepo.repoRoot,
    configDirName: options.configDirName,
  });
}

export function resolveStandardCommandOptions(options) {
  const nextOptions = { ...options };
  const positionals = Array.isArray(nextOptions.positionalArgs) ? nextOptions.positionalArgs : [];
  if (positionals.length > 1) {
    throw new Error(`未知参数：${positionals.slice(1).join(" ")}`);
  }
  if (positionals.length === 1 && !nextOptions.inputPath) {
    nextOptions.inputPath = positionals[0];
  }
  return nextOptions;
}
