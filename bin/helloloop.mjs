#!/usr/bin/env node

import { runCli } from "../src/cli.mjs";

runCli(process.argv.slice(2)).catch((error) => {
  console.error(String(error?.stack || error || ""));
  process.exitCode = 1;
});
