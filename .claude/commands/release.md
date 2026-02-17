Release a new version of critters.

Steps:

1. Pull the latest changes: `git pull origin main`
2. Read the current version from package.json.
3. Run `git log --oneline $(git describe --tags --abbrev=0 2>/dev/null || git rev-list --max-parents=0 HEAD)..HEAD` to see what's changed since the last tag.
4. Ask the user what kind of bump they want: patch, minor, or major. Show them the commits and current version so they can decide.
5. Create a release branch: `git checkout -b release/v<new_version>`
6. Bump the `version` field in package.json to the new version. Do not change anything else in the file.
7. Commit the version bump: `git commit -am "Bump version to v<new_version>"`
8. Push and open a PR: `git push -u origin release/v<new_version>` then `gh pr create --title "Bump version to v<new_version>"`
9. Tell the user to merge the PR once CI passes, then run these commands to tag and trigger the release build:
   ```
   git checkout main && git pull && git tag -a v<new_version> -m "v<new_version>" && git push origin v<new_version>
   ```
   Then check the release build: `gh run list --workflow=release.yml --limit=1`
