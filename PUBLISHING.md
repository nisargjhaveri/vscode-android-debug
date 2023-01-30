1. Commit and validate all the changes so far.
1. Update CHANGELOG.md for the new version.
1. `git add CHANGELOG.md`
1. `npm version [major|minor|patch]`
1. `git push`
1. Wait for the Github Actions to be complete. Download `artifact.zip`
1. Upload `android-debug.vsix` to the Github Release as well as VS Code Marketplace.