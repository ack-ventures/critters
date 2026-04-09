export const RELEASE_NOTES: Array<{ tag: string; date: string; name: string; body: string }> = [
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
  }
];
