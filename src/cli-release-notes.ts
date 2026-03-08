import { RELEASE_NOTES } from "./release-notes.js";
import { VERSION } from "./version.js";

export function runReleaseNotes(): void {
  if (RELEASE_NOTES.length === 0) {
    console.log("No release notes available (dev build).");
    return;
  }

  for (const release of RELEASE_NOTES) {
    const current = release.tag === `v${VERSION}` ? " (current)" : "";
    console.log(`\x1b[1m${release.tag}${current}\x1b[0m — ${release.date}`);
    if (release.body) {
      console.log(release.body.split("\n").map((l) => `  ${l}`).join("\n"));
    }
    console.log();
  }
}
