const { execFileSync } = require("child_process");
const fs = require("fs");

try {
  const listJson = execFileSync(
    "gh",
    ["release", "list", "--limit", "1000", "--json", "tagName,publishedAt,name"],
    { encoding: "utf8" }
  );
  const releases = JSON.parse(listJson);
  const notes = releases.map((r) => {
    try {
      const body = execFileSync(
        "gh",
        ["release", "view", r.tagName, "--json", "body", "-q", ".body"],
        { encoding: "utf8" }
      ).trim();
      return {
        tag: r.tagName,
        date: r.publishedAt.split("T")[0],
        name: r.name || r.tagName,
        body,
      };
    } catch {
      return {
        tag: r.tagName,
        date: r.publishedAt.split("T")[0],
        name: r.name || r.tagName,
        body: "",
      };
    }
  });

  // Generate notes for the current tag being built (not yet released)
  const currentTag = process.env.GITHUB_REF_NAME;
  if (currentTag && !notes.some((n) => n.tag === currentTag)) {
    try {
      const generated = execFileSync(
        "gh",
        ["api", "repos/{owner}/{repo}/releases/generate-notes",
         "-f", `tag_name=${currentTag}`,
         "--jq", ".body"],
        { encoding: "utf8" }
      ).trim();
      notes.unshift({
        tag: currentTag,
        date: new Date().toISOString().split("T")[0],
        name: currentTag,
        body: generated,
      });
      console.log(`Generated notes for current tag ${currentTag}`);
    } catch (e) {
      console.log(`Could not generate notes for ${currentTag}: ${e.message}`);
    }
  }

  fs.writeFileSync(
    "src/release-notes.ts",
    "export const RELEASE_NOTES: Array<{ tag: string; date: string; name: string; body: string }> = " +
      JSON.stringify(notes, null, 2) +
      ";\n"
  );
  console.log(`Bundled ${notes.length} release notes into src/release-notes.ts`);
} catch (err) {
  // If gh is not available or fails, preserve whatever is already checked in
  // rather than clobbering it with an empty array (which would wipe release
  // notes for any downstream local build that doesn't have gh auth).
  if (!fs.existsSync("src/release-notes.ts")) {
    fs.writeFileSync(
      "src/release-notes.ts",
      "export const RELEASE_NOTES: Array<{ tag: string; date: string; name: string; body: string }> = [];\n"
    );
    console.log(`gh not available (${err.message}) — wrote empty release notes (no existing file)`);
  } else {
    console.log(`gh not available (${err.message}) — keeping existing src/release-notes.ts`);
  }
}
