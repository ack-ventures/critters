import { runInit } from "./init.js";
import { runInitRepo } from "./init-repo.js";
import { runStatus } from "./status.js";
import { checkForUpdate, fetchLatestVersion, getDisplayVersion } from "./updater.js";
import { VERSION } from "./version.js";

/**
 * Routes CLI subcommands. Returns true if a subcommand was handled
 * (caller should not start daemon), false otherwise.
 */
export async function routeSubcommand(subcommand: string | undefined): Promise<boolean> {
  // Handle --version before the generic flag check
  if (subcommand === "version" || subcommand === "--version") {
    await fetchLatestVersion();
    console.log(`Critters ${getDisplayVersion()}`);
    process.exit(0);
  }

  if (!subcommand || subcommand.startsWith("--")) return false;

  if (subcommand === "help") {
    await fetchLatestVersion();
    console.log(`Critters ${getDisplayVersion()}

Usage: critters [command] [flags]

Commands:
  (none)      Start the daemon
  retry       Retry a failed critter (or --all-failed for bulk retry)
  stop        Stop the daemon gracefully
  kill        Kill a running critter (or --all, --type <name>)
  restart     Restart the daemon
  kickoff     Trigger an immediate poll cycle
  status      Show daemon status
  history     Show past critter runs (--last N, --failed, --type, --json)
  version     Show version
  release-notes Show release notes for recent versions
  update      Check for and apply updates
  init        Interactive config setup (~/.critters/)
  list-types  Show configured critter types
  logs        Show logs for a critter run
  tail        Live-stream output from all active critters
  init-repo   Scaffold .critters.yaml in current repo
  prompt-help Launch Claude to help design critter types and prompts
  prompt      Work with phase prompts (render — preview substituted prompt)
  clean       Clean up stale work directories (--branches, --panes)
  validate    Validate config file without starting daemon
  help        Show this help

Flags:
  --dry-run       Poll once, show what would happen, and exit
  --no-tmux       Run without tmux (daemonize to background, log to file)
  --skip-update   Skip auto-update check on startup
  --config PATH   Use a custom config file
  --type NAME     Filter to a specific critter type (use with --dry-run)
  --json-logs     Output structured JSON logs (one object per line)
  --no-watch      Disable config file watching (no hot-reload)

Clean flags:
  --branches   Clean up stale critter branches from remotes
  --panes      Clean up stale tmux panes from failed critters
  --all        Remove all work directories (not just stale ones)
  --dry-run    Show what would be deleted without deleting

Logs flags:
  --phase planning|execution|review  Show specific phase (default: most recent)
  --follow, -f                       Tail mode (stream new output)

History flags:
  --last N          Number of runs to show (default: 20)
  --failed          Show only failed runs
  --type NAME       Filter by critter type
  --json            Output as JSON array

Retry flags:
  --all-failed             Retry all failed critters
  --since <duration>       Filter to issues updated within duration (e.g. 24h, 3d, 1w)
  --type <name>            Filter to a specific critter type
  --dry-run                Show what would be retried without making changes

Kill flags:
  --all            Kill all running critters
  --type <name>    Kill all critters of a specific type

Tail flags:
  --type NAME  Filter to a specific critter type`);
    process.exit(0);
  }

  if (subcommand === "update") {
    await checkForUpdate(VERSION, { force: true });
    process.exit(0);
  }

  if (subcommand === "status") {
    await runStatus();
    process.exit(0);
  }

  if (subcommand === "init") {
    await runInit();
    process.exit(0);
  }

  if (subcommand === "logs") {
    const { runLogs } = await import("./logs.js");
    await runLogs(Bun.argv.slice(3));
    process.exit(0);
  }

  if (subcommand === "retry") {
    const allFailed = Bun.argv.includes("--all-failed");
    if (allFailed) {
      const dryRun = Bun.argv.includes("--dry-run");
      const sinceIdx = Bun.argv.indexOf("--since");
      const since = sinceIdx !== -1 ? Bun.argv[sinceIdx + 1] : undefined;
      const typeIdx = Bun.argv.indexOf("--type");
      const typeName = typeIdx !== -1 ? Bun.argv[typeIdx + 1] : undefined;
      const { runRetryAllFailed } = await import("./cli-retry.js");
      await runRetryAllFailed({ dryRun, since, typeName });
      process.exit(0);
    }

    const identifier = Bun.argv[3];
    if (!identifier) {
      console.error("Usage: critters retry <issue-identifier> [--force]\n       critters retry --all-failed [--since <duration>] [--type <name>] [--dry-run]\n\nExample: critters retry ACK-101");
      process.exit(1);
    }
    const force = Bun.argv.includes("--force");
    const { runRetry } = await import("./cli-retry.js");
    await runRetry(identifier, force);
    process.exit(0);
  }

  if (subcommand === "init-repo") {
    await runInitRepo();
    process.exit(0);
  }

  if (subcommand === "validate") {
    const configIdx = Bun.argv.indexOf("--config");
    const configPath = configIdx !== -1 && Bun.argv[configIdx + 1]
      ? Bun.argv[configIdx + 1]
      : undefined;
    const { runValidate } = await import("./validate.js");
    await runValidate(configPath);
    process.exit(0);
  }

  if (subcommand === "kickoff") {
    const { runKickoff } = await import("./cli-kickoff.js");
    await runKickoff();
    process.exit(0);
  }

  if (subcommand === "restart") {
    const { runRestart } = await import("./cli-restart.js");
    await runRestart();
    process.exit(0);
  }

  if (subcommand === "stop") {
    const { runStop } = await import("./cli-stop.js");
    await runStop();
    process.exit(0);
  }

  if (subcommand === "kill") {
    const { runKill } = await import("./cli-kill.js");
    await runKill(Bun.argv.slice(3));
    process.exit(0);
  }

  if (subcommand === "prompt-help") {
    const { runPromptHelp } = await import("./prompt-help.js");
    await runPromptHelp();
    process.exit(0);
  }

  if (subcommand === "prompt") {
    const sub = Bun.argv[3];
    if (sub === "render") {
      const { runPromptRender } = await import("./cli-prompt-render.js");
      await runPromptRender(Bun.argv.slice(4));
      process.exit(0);
    }
    console.error(`Unknown 'prompt' subcommand: ${sub ?? "(none)"}\nUsage: critters prompt render <type> <phase> [flags]`);
    process.exit(1);
  }

  if (subcommand === "list-types") {
    const { runListTypes } = await import("./cli-list-types.js");
    const configIdx = Bun.argv.indexOf("--config");
    const configPath = configIdx !== -1 && Bun.argv[configIdx + 1] ? Bun.argv[configIdx + 1] : undefined;
    await runListTypes(configPath);
    process.exit(0);
  }

  if (subcommand === "clean") {
    const { runClean } = await import("./cli-clean.js");
    await runClean(Bun.argv.slice(3));
    process.exit(0);
  }

  if (subcommand === "tail") {
    const { tailCommand } = await import("./cli-tail.js");
    await tailCommand(Bun.argv.slice(3));
    process.exit(0);
  }

  if (subcommand === "history") {
    const { runHistory } = await import("./cli-history.js");
    await runHistory(Bun.argv.slice(3));
    process.exit(0);
  }

  if (subcommand === "release-notes") {
    const { runReleaseNotes } = await import("./cli-release-notes.js");
    runReleaseNotes();
    process.exit(0);
  }

  // Unknown subcommand
  console.error(`Unknown command: ${subcommand}\nRun 'critters help' for usage.`);
  process.exit(1);
}
