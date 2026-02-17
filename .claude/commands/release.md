Release a new version of critters.

Steps:

1. Pull the latest changes: `git pull origin main`
2. Read the current version from package.json.
3. Run `git log --oneline $(git describe --tags --abbrev=0 2>/dev/null || git rev-list --max-parents=0 HEAD)..HEAD` to see what's changed since the last tag.
4. Ask the user what kind of bump they want: patch, minor, or major. Show them the commits and current version so they can decide.
5. Bump the `version` field in package.json to the new version. Do not change anything else in the file.
6. Commit the version bump: `git commit -am "Bump version to v<new_version>"`
7. Create an annotated tag: `git tag -a v<new_version> -m "v<new_version>"`
8. Ask the user to confirm before pushing.
9. Push the commit and tag: `git push && git push origin v<new_version>`
10. Show the user the GitHub Actions URL so they can watch the release build: `gh run list --workflow=release.yml --limit=1`
