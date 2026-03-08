import { RELEASE_NOTES } from "./release-notes.js";
import { VERSION } from "./version.js";

export function shortenBody(body: string): string {
  return body
    .split("\n")
    .map((line) =>
      line.replace(
        /^(\* .+?) (?:by @\S+ )?in https:\/\/github\.com\/\S+\/pull\/(\d+)$/,
        "$1 (#$2)"
      )
    )
    .filter((line) => !/^\*\*Full Changelog\*\*: https:\/\/.+$/.test(line))
    .join("\n")
    .trimEnd();
}

export function runReleaseNotes(): void {
  if (RELEASE_NOTES.length === 0) {
    console.log("No release notes available (dev build).");
    return;
  }

  const sorted = [...RELEASE_NOTES].reverse();
  for (const release of sorted) {
    const current = release.tag === `v${VERSION}` ? " (current)" : "";
    console.log(`\x1b[1m${release.tag}${current}\x1b[0m — ${release.date}`);
    if (release.body) {
      console.log(
        shortenBody(release.body)
          .split("\n")
          .map((l) => `  ${l}`)
          .join("\n")
      );
    }
    console.log();
  }
}
