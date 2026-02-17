Release a new version of critters.

Steps:

1. Read the current version from package.json.
2. Run `git log --oneline $(git describe --tags --abbrev=0 2>/dev/null || git rev-list --max-parents=0 HEAD)..HEAD` to see what's changed since the last tag.
3. Ask the user what kind of bump they want: patch, minor, or major. Show them the commits and current version so they can decide.
4. Bump the `version` field in package.json to the new version. Do not change anything else in the file.
5. Commit the version bump: `git commit -am "Bump version to v<new_version>"`
6. Create an annotated tag: `git tag -a v<new_version> -m "v<new_version>"`
7. Ask the user to confirm before pushing.
8. Push the commit and tag: `git push && git push origin v<new_version>`
9. Show the user the GitHub Actions URL so they can watch the release build: `gh run list --workflow=release.yml --limit=1`
