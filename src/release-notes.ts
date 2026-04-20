export const RELEASE_NOTES: Array<{ tag: string; date: string; name: string; body: string }> = [
  {
    "tag": "v1.8.0",
    "date": "2026-04-19",
    "name": "v1.8.0",
    "body": "## What's Changed\n* Redesign dashboard with Console layout by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/337\n* Rewrite dashboard as a React SPA by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/338\n* [ACK-322] Reduce active critter log text size on mobile by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/339\n* [ACK-325] Disable mobile browser text auto-size-adjust on dashboard by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/341\n* [ACK-324] Shrink active critter tail text further on mobile by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/340\n* Regenerate dashboard bundle, document build step, fix pre-commit by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/342\n* [ACK-323] Show issue title in Recent activity table by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/343\n* [ACK-327] Redesign full log page and wire up activity row clicks by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/345\n* Make activity rows fully clickable + title backfill script by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/346\n* Color log-viewer lines like the dashboard tail by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/347\n* Dedupe phase list when resolving from tracker attachments by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/348\n* Scale dashboard UI 1.2x on desktop by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/349\n* Bump dashboard font-sizes by 1px by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/350\n* Refresh bundled release notes + preserve on gh failure by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/351\n* Sidebar toggle, reorder insights, stack live-hero < 1500px by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/352\n* Bump version to v1.8.0 by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/353\n\n\n**Full Changelog**: https://github.com/ack-ventures/critters/compare/v1.7.15...v1.8.0"
  },
  {
    "tag": "v1.7.15",
    "date": "2026-04-18",
    "name": "v1.7.15",
    "body": "## What's Changed\n* Add `critters prompt render` for previewing phase prompts by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/335\n* Bump version to v1.7.15 by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/336\n\n\n**Full Changelog**: https://github.com/ack-ventures/critters/compare/v1.7.14...v1.7.15"
  },
  {
    "tag": "v1.7.14",
    "date": "2026-04-18",
    "name": "v1.7.14",
    "body": "## What's Changed\n* [ACK-316] Log errors from background log rotation instead of silently swallowing by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/331\n* [ACK-315] Extract formatError helper for error message formatting (partial) by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/332\n* [ACK-317] Fall back to output log tail when stderr is empty in phase failure message by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/333\n* Bump version to v1.7.14 by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/334\n\n\n**Full Changelog**: https://github.com/ack-ventures/critters/compare/v1.7.13...v1.7.14"
  },
  {
    "tag": "v1.7.13",
    "date": "2026-04-18",
    "name": "v1.7.13",
    "body": "## What's Changed\n* Update README intro to reflect configurable agentic workflows by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/328\n* [ACK-314] Add `permissionMode` phase config to forward to `claude --permission-mode` by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/329\n* Bump version to v1.7.13 by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/330\n\n\n**Full Changelog**: https://github.com/ack-ventures/critters/compare/v1.7.12...v1.7.13"
  },
  {
    "tag": "v1.7.12",
    "date": "2026-04-15",
    "name": "v1.7.12",
    "body": "## What's Changed\n* Fix daemon failing to start when stale tmux session exists by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/326\n* Bump version to v1.7.12 by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/327\n\n\n**Full Changelog**: https://github.com/ack-ventures/critters/compare/v1.7.11...v1.7.12"
  },
  {
    "tag": "v1.7.11",
    "date": "2026-04-13",
    "name": "v1.7.11",
    "body": "## What's Changed\n* Fix release notes order and 10-release limit by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/324\n* Bump version to v1.7.11 by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/325\n\n\n**Full Changelog**: https://github.com/ack-ventures/critters/compare/v1.7.10...v1.7.11"
  },
  {
    "tag": "v1.7.10",
    "date": "2026-04-13",
    "name": "v1.7.10",
    "body": "## What's Changed\n* Bundle release notes on runner instead of in Docker build by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/322\n* Bump version to v1.7.10 by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/323\n\n\n**Full Changelog**: https://github.com/ack-ventures/critters/compare/v1.7.9...v1.7.10"
  },
  {
    "tag": "v1.7.9",
    "date": "2026-04-12",
    "name": "v1.7.9",
    "body": "## What's Changed\n* [ACK-313] Dashboard issue page: show full cost across all phases after work dir cleanup by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/318\n* Fix phase log upload, Linear auth, and human-readable tracker fallback by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/320\n* Bump version to v1.7.9 by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/321\n\n\n**Full Changelog**: https://github.com/ack-ventures/critters/compare/v1.7.8...v1.7.9"
  },
  {
    "tag": "v1.7.8",
    "date": "2026-04-12",
    "name": "v1.7.8",
    "body": "## What's Changed\n* [ACK-311] Add release notes page to the web dashboard by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/316\n* [ACK-312] Dashboard issue page: fall back to Linear attachments when local logs are gone by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/317\n* Bump version to v1.7.8 by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/319\n\n\n**Full Changelog**: https://github.com/ack-ventures/critters/compare/v1.7.7...v1.7.8"
  },
  {
    "tag": "v1.7.7",
    "date": "2026-04-12",
    "name": "v1.7.7",
    "body": "## What's Changed\n* [ACK-310] Skip directory cleanup while critters are active or queued by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/314\n* Bump version to v1.7.7 by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/315\n\n\n**Full Changelog**: https://github.com/ack-ventures/critters/compare/v1.7.6...v1.7.7"
  },
  {
    "tag": "v1.7.6",
    "date": "2026-04-11",
    "name": "v1.7.6",
    "body": "## What's Changed\n* Add runtime setup script for Docker container by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/312\n* Bump version to v1.7.6 by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/313\n\n\n**Full Changelog**: https://github.com/ack-ventures/critters/compare/v1.7.5...v1.7.6"
  },
  {
    "tag": "v1.7.5",
    "date": "2026-04-10",
    "name": "v1.7.5",
    "body": "## What's Changed\n* [ACK-303] Fix dashboard to retrieve logs from Linear after work directory cleanup by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/309\n* [ACK-304] Replace custom CSS/SVG charts with Chart.js in dashboard by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/310\n* Bump version to v1.7.5 by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/311\n\n\n**Full Changelog**: https://github.com/ack-ventures/critters/compare/v1.7.4...v1.7.5"
  },
  {
    "tag": "v1.7.4",
    "date": "2026-04-10",
    "name": "v1.7.4",
    "body": "## What's Changed\n* Switch Docker image to native Claude Code binary by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/307\n* Bump version to v1.7.4 by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/308\n\n\n**Full Changelog**: https://github.com/ack-ventures/critters/compare/v1.7.3...v1.7.4"
  },
  {
    "tag": "v1.7.3",
    "date": "2026-04-10",
    "name": "v1.7.3",
    "body": "## What's Changed\n* Exclude plan files from git when commitPlans is disabled by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/305\n* Bump version to v1.7.3 by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/306\n\n\n**Full Changelog**: https://github.com/ack-ventures/critters/compare/v1.7.2...v1.7.3"
  },
  {
    "tag": "v1.7.2",
    "date": "2026-04-10",
    "name": "v1.7.2",
    "body": "## What's Changed\n* Fix docker-compose env vars overriding .env by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/303\n* Bump version to v1.7.2 by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/304\n\n\n**Full Changelog**: https://github.com/ack-ventures/critters/compare/v1.7.1...v1.7.2"
  },
  {
    "tag": "v1.7.1",
    "date": "2026-04-10",
    "name": "v1.7.1",
    "body": "## What's Changed\n* Add multi-platform Docker builds (amd64 + arm64) by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/301\n* Bump version to v1.7.1 by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/302\n\n\n**Full Changelog**: https://github.com/ack-ventures/critters/compare/v1.7.0...v1.7.1"
  },
  {
    "tag": "v1.7.0",
    "date": "2026-04-09",
    "name": "v1.7.0",
    "body": "## What's Changed\n* [ACK-282] Add commitPlans config option to README documentation by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/298\n* Refactor: decompose monolithic modules by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/299\n* Bump version to v1.7.0 by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/300\n\n\n**Full Changelog**: https://github.com/ack-ventures/critters/compare/v1.6.2...v1.7.0"
  },
  {
    "tag": "v1.6.2",
    "date": "2026-04-09",
    "name": "v1.6.2",
    "body": "## What's Changed\n* [ACK-279] Add unit tests for loadEnvFallback in env.ts by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/294\n* [ACK-280] Skip committing plan files to branch, keep them only in PR description by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/296\n* Fix Docker daemonization and auth for containerized deployments by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/295\n* Bump version to v1.6.2 by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/297\n\n\n**Full Changelog**: https://github.com/ack-ventures/critters/compare/v1.6.1...v1.6.2"
  },
  {
    "tag": "v1.6.1",
    "date": "2026-04-09",
    "name": "v1.6.1",
    "body": "## What's Changed\n* Add prod Docker target and linux-arm64 release binary by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/292\n* Bump version to v1.6.1 by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/293\n\n\n**Full Changelog**: https://github.com/ack-ventures/critters/compare/v1.6.0...v1.6.1"
  },
  {
    "tag": "v1.6.0",
    "date": "2026-04-06",
    "name": "v1.6.0",
    "body": "## What's Changed\n* [ACK-274] Document the review/fix-review-comments critter loop in README by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/288\n* [ACK-275] Tighten the README quickstart for first-time setup by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/290\n* Add mixed CLI phase support and review enforcement by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/289\n* Bump version to v1.6.0 by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/291\n\n\n**Full Changelog**: https://github.com/ack-ventures/critters/compare/v1.5.0...v1.6.0"
  },
  {
    "tag": "v1.5.0",
    "date": "2026-04-01",
    "name": "v1.5.0",
    "body": "## What's Changed\n* Default claimStatus to 'In Progress' for custom critter types by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/284\n* Fix claimStatus default to only apply for unstarted trigger types by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/285\n* Bump version to v1.5.0 by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/286\n\n\n**Full Changelog**: https://github.com/ack-ventures/critters/compare/v1.4.4...v1.5.0"
  },
  {
    "tag": "v1.4.4",
    "date": "2026-04-01",
    "name": "v1.4.4",
    "body": "## What's Changed\n* Fix duplicate dispatch when issue matches multiple critter types by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/282\n* Bump version to v1.4.4 by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/283\n\n\n**Full Changelog**: https://github.com/ack-ventures/critters/compare/v1.4.3...v1.4.4"
  },
  {
    "tag": "v1.4.3",
    "date": "2026-03-30",
    "name": "v1.4.3",
    "body": "## What's Changed\n* Revert GitHub Issues tracker provider by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/280\n* Bump version to v1.4.3 by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/281\n\n\n**Full Changelog**: https://github.com/ack-ventures/critters/compare/v1.4.2...v1.4.3"
  },
  {
    "tag": "v1.4.2",
    "date": "2026-03-30",
    "name": "v1.4.2",
    "body": "## What's Changed\n* Fix GitHub tracker blocker resolution by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/278\n* Bump version to v1.4.2 by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/279\n\n\n**Full Changelog**: https://github.com/ack-ventures/critters/compare/v1.4.1...v1.4.2"
  },
  {
    "tag": "v1.4.1",
    "date": "2026-03-30",
    "name": "v1.4.1",
    "body": "## What's Changed\n* [ACK-273] Add critters kill command to stop a running critter by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/273\n* Fix GitHub tracker to auto-create status labels by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/276\n* Bump version to v1.4.1 by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/277\n\n\n**Full Changelog**: https://github.com/ack-ventures/critters/compare/v1.4.0...v1.4.1"
  },
  {
    "tag": "v1.4.0",
    "date": "2026-03-30",
    "name": "v1.4.0",
    "body": "## What's Changed\n* Add GitHub Issues as a tracker provider by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/274\n* Bump version to v1.4.0 by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/275\n\n\n**Full Changelog**: https://github.com/ack-ventures/critters/compare/v1.3.1...v1.4.0"
  },
  {
    "tag": "v1.3.1",
    "date": "2026-03-19",
    "name": "v1.3.1",
    "body": "## What's Changed\n* [ACK-258] Update release command to only review README.md, not CLAUDE.md by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/270\n* Add quietComments option to suppress status comments by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/271\n* Bump version to v1.3.1 by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/272\n\n\n**Full Changelog**: https://github.com/ack-ventures/critters/compare/v1.3.0...v1.3.1"
  },
  {
    "tag": "v1.3.0",
    "date": "2026-03-16",
    "name": "v1.3.0",
    "body": "## What's Changed\n* [ACK-256] Daemonize process when using --no-tmux flag by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/267\n* [ACK-257] Drastically reduce CLAUDE.md to essential dev guidance only by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/268\n* Bump version to v1.3.0 by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/269\n\n\n**Full Changelog**: https://github.com/ack-ventures/critters/compare/v1.2.0...v1.3.0"
  },
  {
    "tag": "v1.2.0",
    "date": "2026-03-16",
    "name": "v1.2.0",
    "body": "## What's Changed\n* [ACK-255] Add --type filter to critters history command by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/264\n* Add CLI adapter abstraction for multi-CLI support by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/265\n* Bump version to v1.2.0 by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/266\n\n\n**Full Changelog**: https://github.com/ack-ventures/critters/compare/v1.1.0...v1.2.0"
  },
  {
    "tag": "v1.1.0",
    "date": "2026-03-15",
    "name": "v1.1.0",
    "body": "## What's Changed\n* [ACK-247] Dashboard: add per-type stats cards by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/253\n* [ACK-249] Dashboard: add browser notifications for critter events by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/254\n* [ACK-248] Dashboard: show live cost on active critters by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/255\n* [ACK-245] Dashboard: add tracker ticket link on issue detail page by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/258\n* [ACK-246] Dashboard: add filterable recent activity table by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/259\n* [ACK-250] Dashboard: show estimated time remaining for active critters by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/252\n* [ACK-244] Dashboard: link active critter identifiers to tracker tickets by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/257\n* [ACK-251] Dashboard: show PR CI and review status in recent activity by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/256\n* [ACK-252] Dashboard: click-through from charts to filtered activity by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/260\n* [ACK-253] Add critters stop CLI command by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/261\n* [ACK-254] Add configurable auto-update timer by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/262\n* Bump version to v1.1.0 by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/263\n\n\n**Full Changelog**: https://github.com/ack-ventures/critters/compare/v1.0.2...v1.1.0"
  },
  {
    "tag": "v1.0.2",
    "date": "2026-03-14",
    "name": "v1.0.2",
    "body": "## What's Changed\n* [ACK-243] Dashboard: link recent activity Issue column to tracker ticket, add separate logs link by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/250\n* Bump version to v1.0.2 (#251) by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/251\n\n\n**Full Changelog**: https://github.com/ack-ventures/critters/compare/v1.0.1...v1.0.2"
  },
  {
    "tag": "v1.0.1",
    "date": "2026-03-14",
    "name": "v1.0.1",
    "body": "## What's Changed\n* Add base branch field to dashboard create form by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/248\n* Bump version to v1.0.1 by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/249\n\n\n**Full Changelog**: https://github.com/ack-ventures/critters/compare/v1.0.0...v1.0.1"
  },
  {
    "tag": "v1.0.0",
    "date": "2026-03-13",
    "name": "v1.0.0",
    "body": "## What's Changed\n* Bump version to v1.0.0 by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/247\n\n\n**Full Changelog**: https://github.com/ack-ventures/critters/compare/v0.10.2...v1.0.0"
  },
  {
    "tag": "v0.10.2",
    "date": "2026-03-13",
    "name": "v0.10.2",
    "body": "## What's Changed\n* Fix local clone base branch detection + add branch: override support by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/245\n* Bump version to v0.10.2 by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/246\n\n\n**Full Changelog**: https://github.com/ack-ventures/critters/compare/v0.10.1...v0.10.2"
  },
  {
    "tag": "v0.10.1",
    "date": "2026-03-12",
    "name": "v0.10.1",
    "body": "## What's Changed\n* [ACK-242] Add critter version to tracker comments and PR descriptions by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/243\n* Bump version to v0.10.1 by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/244\n\n\n**Full Changelog**: https://github.com/ack-ventures/critters/compare/v0.10.0...v0.10.1"
  },
  {
    "tag": "v0.10.0",
    "date": "2026-03-11",
    "name": "v0.10.0",
    "body": "## What's Changed\n* [ACK-239] Generate systemd service template from critters init by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/229\n* [ACK-235] Add critters history command by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/230\n* [ACK-234] Clean up stale tmux panes from failed critters by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/232\n* [ACK-231] Document MCP config for critters by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/231\n* [ACK-229] Hot-reload config without daemon restart by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/233\n* [ACK-237] Add webhook triggers for Linear and Jira by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/235\n* [ACK-230] Add critters retry --all-failed for bulk retry by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/236\n* [ACK-233] Per-issue dashboard drill-down page by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/237\n* [ACK-238] Add circuit breaker for tracker API failures by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/234\n* [ACK-236] Structured logging improvements by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/238\n* [ACK-240] Add cost budget to kill expensive critters by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/240\n* [ACK-232] Add disk space check before cloning repos by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/239\n* [ACK-241] Fix SIGTERM not releasing port during graceful shutdown by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/241\n* Bump version to v0.10.0 by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/242\n\n\n**Full Changelog**: https://github.com/ack-ventures/critters/compare/v0.9.15...v0.10.0"
  },
  {
    "tag": "v0.9.15",
    "date": "2026-03-11",
    "name": "v0.9.15",
    "body": "## What's Changed\n* Fix restart killing daemon in tmux by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/225\n* Ensure clones land on the correct default branch by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/226\n* [ACK-225] Add configurable work directory cleanup interval and stale threshold by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/227\n* Bump version to v0.9.15 by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/228\n\n\n**Full Changelog**: https://github.com/ack-ventures/critters/compare/v0.9.14...v0.9.15"
  },
  {
    "tag": "v0.9.14",
    "date": "2026-03-11",
    "name": "v0.9.14",
    "body": "## What's Changed\n* Verify and retarget PR base branch after creation by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/223\n* Bump version to v0.9.14 by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/224\n\n\n**Full Changelog**: https://github.com/ack-ventures/critters/compare/v0.9.13...v0.9.14"
  },
  {
    "tag": "v0.9.13",
    "date": "2026-03-11",
    "name": "v0.9.13",
    "body": "## What's Changed\n* Fix PRs targeting wrong base branch and linking to wrong tracker by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/221\n* Bump version to v0.9.13 (#222) by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/222\n\n\n**Full Changelog**: https://github.com/ack-ventures/critters/compare/v0.9.12...v0.9.13"
  },
  {
    "tag": "v0.9.12",
    "date": "2026-03-10",
    "name": "v0.9.12",
    "body": "## What's Changed\n* [ACK-222] Remove auto-restart from critters update command by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/217\n* [ACK-223] Add global unhandled rejection/exception handlers to prevent daemon crashes by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/218\n* [ACK-224] Always log daemon output to file, even in tmux mode by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/219\n* Bump version to v0.9.12 by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/220\n\n\n**Full Changelog**: https://github.com/ack-ventures/critters/compare/v0.9.11...v0.9.12"
  },
  {
    "tag": "v0.9.11",
    "date": "2026-03-10",
    "name": "v0.9.11",
    "body": "## What's Changed\n* [ACK-221] Add large file reading guidance to critter prompts by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/215\n* Bump version to v0.9.11 by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/216\n\n\n**Full Changelog**: https://github.com/ack-ventures/critters/compare/v0.9.10...v0.9.11"
  },
  {
    "tag": "v0.9.10",
    "date": "2026-03-10",
    "name": "v0.9.10",
    "body": "## What's Changed\n* Make Jira status transition failures non-fatal by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/213\n* Bump version to v0.9.10 by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/214\n\n\n**Full Changelog**: https://github.com/ack-ventures/critters/compare/v0.9.9...v0.9.10"
  },
  {
    "tag": "v0.9.9",
    "date": "2026-03-10",
    "name": "v0.9.9",
    "body": "## What's Changed\n* [ACK-220] Add restart command and /restart health endpoint by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/211\n* Bump version to v0.9.9 by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/212\n\n\n**Full Changelog**: https://github.com/ack-ventures/critters/compare/v0.9.8...v0.9.9"
  },
  {
    "tag": "v0.9.8",
    "date": "2026-03-10",
    "name": "v0.9.8",
    "body": "## What's Changed\n* Fix daemon crash from unhandled rejection and simplify codebase by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/209\n* Bump version to v0.9.8 by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/210\n\n\n**Full Changelog**: https://github.com/ack-ventures/critters/compare/v0.9.7...v0.9.8"
  },
  {
    "tag": "v0.9.7",
    "date": "2026-03-10",
    "name": "v0.9.7",
    "body": "## What's Changed\n* Add progress logging for large repo operations by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/207\n* Bump version to v0.9.7 by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/208\n\n\n**Full Changelog**: https://github.com/ack-ventures/critters/compare/v0.9.6...v0.9.7"
  },
  {
    "tag": "v0.9.6",
    "date": "2026-03-10",
    "name": "v0.9.6",
    "body": "## What's Changed\n* Add removeLabel outcome option and defaultRepo config by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/205\n* Bump version to v0.9.6 by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/206\n\n\n**Full Changelog**: https://github.com/ack-ventures/critters/compare/v0.9.5...v0.9.6"
  },
  {
    "tag": "v0.9.5",
    "date": "2026-03-09",
    "name": "v0.9.5",
    "body": "## What's Changed\n* Add Jira improvements, configurable clone depth, and local clone support by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/203\n* Bump version to v0.9.5 by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/204\n\n\n**Full Changelog**: https://github.com/ack-ventures/critters/compare/v0.9.4...v0.9.5"
  },
  {
    "tag": "v0.9.4",
    "date": "2026-03-08",
    "name": "v0.9.4",
    "body": "## What's Changed\n* [ACK-219] Reverse release notes order and shorten lines by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/201\n* Bump version to v0.9.4 by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/202\n\n\n**Full Changelog**: https://github.com/ack-ventures/critters/compare/v0.9.3...v0.9.4"
  },
  {
    "tag": "v0.9.3",
    "date": "2026-03-08",
    "name": "v0.9.3",
    "body": "## What's Changed\n* Fix Dockerfile bundle-release-notes reference to .cjs by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/198\n* Include current version's notes in release-notes by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/199\n* Bump version to v0.9.3 by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/200\n\n\n**Full Changelog**: https://github.com/ack-ventures/critters/compare/v0.9.2...v0.9.3"
  },
  {
    "tag": "v0.9.2",
    "date": "2026-03-08",
    "name": "v0.9.2",
    "body": "## What's Changed\n* [ACK-218] Add release-notes CLI command with build-time bundling by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/195\n* Bump version to v0.9.2 by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/196\n* Fix bundle-release-notes for ESM package by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/197\n\n\n**Full Changelog**: https://github.com/ack-ventures/critters/compare/v0.9.1...v0.9.2"
  },
  {
    "tag": "v0.9.1",
    "date": "2026-03-08",
    "name": "v0.9.1",
    "body": "## What's Changed\n* [ACK-217] Add repo selector to dashboard issue creation modal by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/193\n* Bump version to v0.9.1 by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/194\n\n\n**Full Changelog**: https://github.com/ack-ventures/critters/compare/v0.9.0...v0.9.1"
  },
  {
    "tag": "v0.9.0",
    "date": "2026-03-08",
    "name": "v0.9.0",
    "body": "## What's Changed\n* [ACK-204] Remove \"Tips from usage\" section from README by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/177\n* [ACK-205] Add model name to progress comments on Linear and Jira by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/178\n* [ACK-206] Add ngrok tunnel support to the daemon by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/179\n* [ACK-208] Add createIssue + listTeams to IssueTracker interface and Linear implementation by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/180\n* [ACK-207] Add bearer token auth to dashboard endpoints by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/181\n* [ACK-210] Self-hosting documentation by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/182\n* [ACK-209] Dockerfile + docker-compose for self-hosting by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/183\n* [ACK-211] Implement createIssue + listTeams for JiraTracker by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/184\n* [ACK-212] Add /api/v1/metadata and /api/v1/issues endpoints to health server by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/185\n* [ACK-213] Add issue creation modal to dashboard UI by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/186\n* [ACK-214] Upload full critter logs to issue tracker on success and failure by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/187\n* [ACK-215] Add critter type count to daemon startup log by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/188\n* [ACK-216] Add Docker build status to daemon startup log by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/190\n* Fix Docker build and improve compose defaults by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/189\n* Add openssh-client to Docker image by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/191\n* Bump version to v0.9.0 by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/192\n\n\n**Full Changelog**: https://github.com/ack-ventures/critters/compare/v0.8.1...v0.9.0"
  },
  {
    "tag": "v0.8.1",
    "date": "2026-03-07",
    "name": "v0.8.1",
    "body": "## What's Changed\n* [ACK-203] Add MCP server support to spawned Claude instances by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/175\n* Bump version to v0.8.1 by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/176\n\n\n**Full Changelog**: https://github.com/ack-ventures/critters/compare/v0.8.0...v0.8.1"
  },
  {
    "tag": "v0.8.0",
    "date": "2026-03-07",
    "name": "v0.8.0",
    "body": "## What's Changed\n* [ACK-185] Polish dashboard header & summary cards by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/156\n* [ACK-186] Overhaul dashboard charts by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/157\n* [ACK-187] Improve dashboard activity table & active critters section by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/158\n* [ACK-188] Fix chart x-axis label overlap on smaller screens by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/159\n* [ACK-194] Add cost threshold alerts via Slack by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/161\n* [ACK-189] Add metrics retention with automatic pruning by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/160\n* [ACK-191] Add stale remote branch cleanup to critters clean by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/164\n* [ACK-192] Add warning-level output to critters validate by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/165\n* [ACK-196] Add per-type breakdown to dashboard charts and stats by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/163\n* [ACK-193] Add critters tail command for live multi-critter output by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/166\n* [ACK-190] Enrich PR descriptions with cost, duration, and summary by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/162\n* [ACK-195] Add automatic retry with backoff for transient failures by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/167\n* [ACK-197] Add client-side interactivity to dashboard by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/168\n* [ACK-199] Expand README with general-purpose use cases and examples by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/169\n* [ACK-198] Add live log viewing to dashboard (inline + dedicated page) by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/170\n* [ACK-200] Add composable skills support to phase config by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/171\n* [ACK-201] Dashboard logs: show rich tool details instead of bare [Tool: Name] by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/172\n* [ACK-202] Dashboard logs: fix live streaming so logs update in real-time by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/173\n* Bump version to v0.8.0 by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/174\n\n\n**Full Changelog**: https://github.com/ack-ventures/critters/compare/v0.7.0...v0.8.0"
  },
  {
    "tag": "v0.7.0",
    "date": "2026-03-06",
    "name": "v0.7.0",
    "body": "## What's Changed\n* [ACK-174] Include plan summary in PR description by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/141\n* [ACK-173] Add critters list-types command by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/142\n* [ACK-172] Add --type filter to --dry-run by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/143\n* [ACK-171] Add critters validate command by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/145\n* [ACK-183] Add config hot-reload without daemon restart by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/148\n* [ACK-182] Salvage partial work on critter timeout by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/147\n* [ACK-179] Add PR link to active critters dashboard table by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/150\n* [ACK-175] Thread Slack notifications under initial message by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/144\n* [ACK-178] Add cost tracking to dashboard by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/152\n* [ACK-177] Smarter CI polling with backoff in review critter by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/151\n* [ACK-184] Add critters prompt-help command with embedded docs by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/146\n* [ACK-180] Add --json-logs flag for structured log output by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/153\n* [ACK-181] Add critters clean command for stale work dir cleanup by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/149\n* [ACK-176] Make branch prefix configurable by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/154\n* Bump version to v0.7.0 by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/155\n\n\n**Full Changelog**: https://github.com/ack-ventures/critters/compare/v0.6.1...v0.7.0"
  },
  {
    "tag": "v0.6.1",
    "date": "2026-03-06",
    "name": "v0.6.1",
    "body": "## What's Changed\n* Bump version to v0.6.1 by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/140\n\n\n**Full Changelog**: https://github.com/ack-ventures/critters/compare/v0.6.0...v0.6.1"
  },
  {
    "tag": "v0.6.0",
    "date": "2026-03-06",
    "name": "v0.6.0",
    "body": "## What's Changed\n* Add per-type health counts and update architecture docs by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/132\n* Add Jira integration with multi-provider support by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/138\n* Bump version to v0.6.0 by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/139\n\n\n**Full Changelog**: https://github.com/ack-ventures/critters/compare/v0.5.1...v0.6.0"
  },
  {
    "tag": "v0.5.1",
    "date": "2026-03-04",
    "name": "v0.5.1",
    "body": "## What's Changed\n* [ACK-155] Cache computeMetricsSummary in health server (partial) by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/121\n* feat: more granular lifecycle hooks by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/135\n* [ACK-170] Add --repo flag to gh calls in salvagePartialProgress by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/133\n* [ACK-165] Add a --version flag alias for the version subcommand by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/130\n* [ACK-163, ACK-155] Fix review duration metrics and cache health summary by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/134\n* [ACK-159] Show repo, branch, and phase metadata across all critter surfaces by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/127\n* Remove flaky resolveConfigPath test by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/136\n* Bump version to v0.5.1 by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/137\n\n\n**Full Changelog**: https://github.com/ack-ventures/critters/compare/v0.5.0...v0.5.1"
  },
  {
    "tag": "v0.5.0",
    "date": "2026-03-03",
    "name": "v0.5.0",
    "body": "## What's Changed\n* [ACK-156] Improve getDefaultBranch error handling and messaging by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/122\n* [ACK-154] Extract duplicate shellEscape into utils.ts by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/124\n* [ACK-158] Handle corrupted JSONL lines in getRecentMetrics by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/123\n* [ACK-157] Log hook stdout when non-empty by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/125\n* [ACK-160] Fix shallow clone branch checkout in spawner resume path by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/126\n* [ACK-161] Fix GCS upload content-type header mismatch in uploadFileToIssue by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/128\n* Add configurable critter types and issue tracker abstraction by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/129\n* Bump version to v0.5.0 by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/131\n\n\n**Full Changelog**: https://github.com/ack-ventures/critters/compare/v0.4.5...v0.5.0"
  },
  {
    "tag": "v0.4.5",
    "date": "2026-02-19",
    "name": "v0.4.5",
    "body": "## What's Changed\n* [ACK-150] Fix dashboard chart rendering: z-index, responsiveness, and y-axis labels by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/116\n* [ACK-151] Add elapsed time to critter pane titles by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/117\n* [ACK-152] Show latest released version alongside \"vdev\" in dev builds by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/118\n* [ACK-153] Update CLAUDE.md with missing sections and details by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/119\n* Bump version to v0.4.5 by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/120\n\n\n**Full Changelog**: https://github.com/ack-ventures/critters/compare/v0.4.4...v0.4.5"
  },
  {
    "tag": "v0.4.4",
    "date": "2026-02-18",
    "name": "v0.4.4",
    "body": "## What's Changed\n* [ACK-140] Fix periodic title update overwriting critter pane titles by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/112\n* [ACK-141] Reduce pane title update interval to 10 seconds by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/113\n* [ACK-149] Add hover tooltips and Y-axis labels to dashboard charts by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/114\n* Bump version to v0.4.4 by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/115\n\n\n**Full Changelog**: https://github.com/ack-ventures/critters/compare/v0.4.3...v0.4.4"
  },
  {
    "tag": "v0.4.3",
    "date": "2026-02-18",
    "name": "v0.4.3",
    "body": "## What's Changed\n* [ACK-138] Tell planning critters to use Write instead of Edit for plan revisions by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/109\n* [ACK-137] Add missing URL validation and integration tests for checksum verification by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/107\n* [ACK-136] Improve daemon pane styling, colors, and titles by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/108\n* [ACK-139] Add `critters kickoff` to README and CLAUDE.md by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/110\n* Bump version to v0.4.3 by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/111\n\n\n**Full Changelog**: https://github.com/ack-ventures/critters/compare/v0.4.2...v0.4.3"
  },
  {
    "tag": "v0.4.2",
    "date": "2026-02-18",
    "name": "v0.4.2",
    "body": "## What's Changed\n* [ACK-132] Add SHA-256 checksum verification to updater by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/103\n* [ACK-135] Add `critters kickoff` command to trigger immediate poll by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/105\n* [ACK-134] Validate download URL domain in updater by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/102\n* [ACK-133] Add rollback backup before applying updates by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/104\n* Bump version to v0.4.2 by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/106\n\n\n**Full Changelog**: https://github.com/ack-ventures/critters/compare/v0.4.1...v0.4.2"
  },
  {
    "tag": "v0.4.1",
    "date": "2026-02-18",
    "name": "v0.4.1",
    "body": "## What's Changed\n* [ACK-127] Update README.md and CLAUDE.md with v0.4.0 features by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/95\n* [ACK-128] Replace red pane color with a less alarming alternative by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/96\n* [ACK-129] Fix dashboard duration, charts, and missing reviews by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/97\n* Warn critters not to run the daemon entry point by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/98\n* [ACK-130] Add ticket title to tmux pane title by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/100\n* [ACK-131] Add age-based guard to work directory cleanup by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/99\n* Bump version to v0.4.1 by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/101\n\n\n**Full Changelog**: https://github.com/ack-ventures/critters/compare/v0.4.0...v0.4.1"
  },
  {
    "tag": "v0.4.0",
    "date": "2026-02-18",
    "name": "v0.4.0",
    "body": "## What's Changed\n* [ACK-114] Structured incremental reviewer feedback by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/78\n* [ACK-115] Execution plan checkpointing by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/80\n* [ACK-113] Graceful partial failure handling by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/79\n* [ACK-112] Add pagination to Linear issue queries by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/82\n* [ACK-118] Expand Slack notifications to more lifecycle events by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/83\n* [ACK-116] Add structured JSONL metrics logging by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/85\n* [ACK-119] Add health check HTTP endpoint by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/86\n* [ACK-120] Add web dashboard for critter activity by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/87\n* [ACK-124] Add `critters --dry-run` mode by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/88\n* [ACK-126] Add shell hooks for post-task events by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/89\n* [ACK-125] Add `critters init-repo` command for per-repo config by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/91\n* [ACK-111] Add shared retry utility with exponential backoff by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/81\n* [ACK-117] Add log rotation by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/84\n* [ACK-123] Add `critters logs` CLI command by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/90\n* [ACK-122] Add `critters retry` CLI command by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/93\n* [ACK-121] Add `critters status` CLI command by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/92\n* Bump version to v0.4.0 by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/94\n\n\n**Full Changelog**: https://github.com/ack-ventures/critters/compare/v0.3.1...v0.4.0"
  },
  {
    "tag": "v0.3.1",
    "date": "2026-02-17",
    "name": "v0.3.1",
    "body": "## What's Changed\n* [ACK-108] Add missing planningModel/executionModel and review fields to init config template by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/74\n* [ACK-109] Make `critters init` idempotent — merge new fields into existing config by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/75\n* [ACK-110] Support custom prompt files in ~/.critters/ for planning, execution, and review by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/76\n* Bump version to v0.3.1 by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/77\n\n\n**Full Changelog**: https://github.com/ack-ventures/critters/compare/v0.3.0...v0.3.1"
  },
  {
    "tag": "v0.3.0",
    "date": "2026-02-17",
    "name": "v0.3.0",
    "body": "## What's Changed\n* [ACK-99] Fix and improve failure log uploads to Linear by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/63\n* [ACK-98] Add a 5th color to the critter pane rotation by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/61\n* [ACK-96] Add download progress bar to updater by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/60\n* [ACK-101] Set up test infrastructure and CI workflow by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/64\n* [ACK-100] Randomly assign pane colors and expand to 10 colors by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/69\n* [ACK-103] Add tests for git operations by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/68\n* [ACK-102] Add unit tests for utility functions by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/67\n* [ACK-105] Add tests for stream-filter.jq output by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/66\n* [ACK-104] Add tests for config loading by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/65\n* Update README with improved description of Claude Max 20x by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/70\n* [ACK-106] Add configurable planning and execution model options by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/71\n* [ACK-107] Add unit tests for tailLines utility function by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/72\n* Add review critter workflow by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/73\n\n\n**Full Changelog**: https://github.com/ack-ventures/critters/compare/v0.2.6...v0.3.0"
  },
  {
    "tag": "v0.2.6",
    "date": "2026-02-17",
    "name": "v0.2.6",
    "body": "## What's Changed\n* [ACK-97] Give each critter pane a distinct color scheme for streamed output by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/57\n* Use config workDir as cwd for git clone by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/62\n\n\n**Full Changelog**: https://github.com/ack-ventures/critters/compare/v0.2.5...v0.2.6"
  },
  {
    "tag": "v0.2.5",
    "date": "2026-02-17",
    "name": "v0.2.5",
    "body": "## What's Changed\n* Fix clone retry not catching spawn throws in compiled binary by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/59\n\n\n**Full Changelog**: https://github.com/ack-ventures/critters/compare/v0.2.4...v0.2.5"
  },
  {
    "tag": "v0.2.4",
    "date": "2026-02-17",
    "name": "v0.2.4",
    "body": "## What's Changed\n* Retry git clone on intermittent ENOENT failures by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/58\n\n\n**Full Changelog**: https://github.com/ack-ventures/critters/compare/v0.2.3...v0.2.4"
  },
  {
    "tag": "v0.2.3",
    "date": "2026-02-17",
    "name": "v0.2.3",
    "body": "## What's Changed\n* Fix git not found when binary auto-launches into tmux by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/56\n\n\n**Full Changelog**: https://github.com/ack-ventures/critters/compare/v0.2.2...v0.2.3"
  },
  {
    "tag": "v0.2.2",
    "date": "2026-02-17",
    "name": "v0.2.2",
    "body": "## What's Changed\n* Fix update command for binaries in bun-containing paths by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/54\n* Bump version to v0.2.2 by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/55\n\n\n**Full Changelog**: https://github.com/ack-ventures/critters/compare/v0.2.1...v0.2.2"
  },
  {
    "tag": "v0.2.1",
    "date": "2026-02-17",
    "name": "v0.2.1",
    "body": "## What's Changed\n* Add install script, CLI subcommands, and version embedding by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/50\n* Auto-launch tmux session for compiled binary by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/51\n* Add usage tips and fix poll interval in README by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/52\n* Bump version to v0.2.1 by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/53\n\n\n**Full Changelog**: https://github.com/ack-ventures/critters/compare/v0.2.0...v0.2.1"
  },
  {
    "tag": "v0.2.0",
    "date": "2026-02-17",
    "name": "v0.2.0",
    "body": "## What's Changed\n* [ACK-40] Add startup prerequisite checks for claude and gh CLIs by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/1\n* [ACK-44] Commit plan file to branch before execution phase by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/4\n* [ACK-45] Log version number from package.json on startup by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/7\n* [ACK-43] Add timing and context usage logs for critter tasks by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/5\n* [ACK-46] Add GitHub Actions CI workflow for typecheck on PRs by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/8\n* [ACK-48] Add a README.md by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/9\n* [ACK-47] Add Biome linter and lint CI check on PRs by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/10\n* [ACK-49] Set up Husky pre-commit hook with Biome lint and typecheck by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/11\n* [ACK-55] Set tmux main-horizontal layout after spawning a new pane by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/17\n* [ACK-52] Add error context logging in uploadFileToIssue by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/15\n* [ACK-51] Add queue depth logging in spawner by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/16\n* [ACK-54] Extract shared runCommand utility from duplicated implementations by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/13\n* [ACK-53] Add config value validation in loadConfig by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/14\n* [ACK-50] Add safety validation for workDir config path by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/12\n* [ACK-63] Log allowed tools before execution phase starts by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/18\n* [ACK-61] Validate defaultAllowedTools is non-empty in config by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/21\n* [ACK-56] Add retry logic to PR detection in detectPr by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/24\n* [ACK-64] Log warning when Claude JSON output parsing finds no data by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/19\n* [ACK-59] Run periodic stale work directory cleanup by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/25\n* [ACK-57] Log tmux pane kill failures instead of swallowing errors by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/26\n* [ACK-62] Validate repo URLs in config match git URL patterns by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/20\n* [ACK-58] Clean up /tmp/critter-err-*.log files after task completion by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/23\n* [ACK-60] Extract shared phase error handling helper in spawner by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/22\n* Fix output token counting, add cost to phase stats by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/29\n* [ACK-65] Add .catch() handler for dispatch promise in watcher by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/27\n* [ACK-66] Open PRs as ready instead of draft by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/28\n* Improve critter execution hints and exclude temp files from git by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/34\n* [ACK-70] Log a warning in getDefaultBranch when falling back to \"main\" by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/31\n* [ACK-74] Set tmux pane titles for critter processes by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/33\n* [ACK-68] Improve stderr capture in runCommand by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/30\n* [ACK-69] Distinguish \"no data\" from \"corrupted data\" in Claude JSON log parsing by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/32\n* [ACK-75] Increase poll interval to 120 seconds by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/35\n* [ACK-76] Remove hardcoded macOS assumptions and add setup documentation by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/36\n* [ACK-77] Add test step to CI workflow by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/37\n* [ACK-78] Add CLI flags and no-tmux quiet mode by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/38\n* [ACK-80] Resolve workDir symlinks to match actual filesystem path by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/40\n* [ACK-79] Respect Linear issue dependencies in watcher by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/39\n* [ACK-82] Prep codebase for standalone binary compilation by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/42\n* [ACK-81] Fix --no-tmux process exiting immediately when backgrounded by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/41\n* [ACK-83] Add auto-updater to check GitHub Releases on startup by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/43\n* [ACK-84] Add CI workflow to compile and publish releases by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/44\n* Add /release slash command by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/46\n* [ACK-86] Clean up org-specific references for open-source release by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/47\n* [ACK-87] Add CONTRIBUTING.md for open-source contributors by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/48\n* [ACK-85] Add MIT LICENSE and update package.json metadata for OSS by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/45\n* Bump version to v0.2.0 by @andrewklingelhofer in https://github.com/ack-ventures/critters/pull/49\n\n## New Contributors\n* @andrewklingelhofer made their first contribution in https://github.com/ack-ventures/critters/pull/1\n\n**Full Changelog**: https://github.com/ack-ventures/critters/commits/v0.2.0"
  }
];
