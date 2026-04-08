#!/usr/bin/env bun

import { routeSubcommand } from "./cli-router.js";
import { logError } from "./logger.js";

const subcommand = Bun.argv[2];
const handled = await routeSubcommand(subcommand);
if (!handled) {
  const { startDaemon } = await import("./daemon.js");
  await startDaemon().catch((err) => {
    logError(`Fatal: ${err}`);
    process.exit(1);
  });
}
