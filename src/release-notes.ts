export const RELEASE_NOTES: Array<{ tag: string; date: string; name: string; body: string }> = [
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
  }
];
