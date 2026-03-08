const { execFileSync } = require("child_process");
const fs = require("fs");

try {
  const listJson = execFileSync(
    "gh",
    ["release", "list", "--limit", "10", "--json", "tagName,publishedAt,name"],
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
  fs.writeFileSync(
    "src/release-notes.ts",
    "export const RELEASE_NOTES: Array<{ tag: string; date: string; name: string; body: string }> = " +
      JSON.stringify(notes, null, 2) +
      ";\n"
  );
  console.log(`Bundled ${notes.length} release notes into src/release-notes.ts`);
} catch {
  // If gh is not available or fails, write empty notes
  fs.writeFileSync(
    "src/release-notes.ts",
    "export const RELEASE_NOTES: Array<{ tag: string; date: string; name: string; body: string }> = [];\n"
  );
  console.log("gh not available — wrote empty release notes");
}
