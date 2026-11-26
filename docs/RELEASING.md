# Releasing

Versions follow [semver](https://semver.org): `MAJOR.MINOR.PATCH`, with `-rc.N` for release candidates. The notes are the `## Unreleased` section of `CHANGELOG.md`, so every change adds its entry there.

## Cut a release

Run **Actions → Cut release → Run workflow** on `main` and pick the bump. Tick **Dry run** first to see the release commit without pushing it.

The [Cut release workflow](../.github/workflows/cut-release.yml) renames `## Unreleased` to `## X.Y.Z - YYYY-MM-DD`, sets the version in `package.json`, `package-lock.json` and `src/version.ts`, then pushes that commit and the `vX.Y.Z` tag to `main`. It refuses to run if `## Unreleased` is empty or CI hasn't passed on `main`.

Pushing the tag starts the [Release workflow](../.github/workflows/release.yml). It checks that the tag, `package.json`, `src/version.ts` and the changelog agree, runs CI on the tagged commit, builds amd64 and arm64 images, and publishes the GitHub Release last.

For a release candidate, tick **Release candidate**. Running the workflow again without that box ticked finishes the release and merges the candidates' changelog sections into its section.

## By hand

1. Set the version in `package.json` (`npm version X.Y.Z --no-git-tag-version`) and `src/version.ts`, and rename `## Unreleased` in `CHANGELOG.md` to `## X.Y.Z - YYYY-MM-DD`.
2. Merge that to `main`.
3. Tag the merge commit and push the tag:

   ```bash
   git tag -s vX.Y.Z -m "release: vX.Y.Z"
   git push origin vX.Y.Z
   ```

## Release notes

To write the notes yourself, create a draft release for the tag before it is pushed. The workflow publishes the draft as it is.

## Image tags

| Release | Tags |
| --- | --- |
| `v1.2.3` | `1.2.3`, `1.2`, `1`, `latest`, `sha-<commit>` |
| `v0.2.3` | `0.2.3`, `0.2`, `latest`, `sha-<commit>` |
| `v1.3.0-rc.1` | `1.3.0-rc.1`, `sha-<commit>` |

`latest` only moves forward: a patch for an older line doesn't take it.

## If a release fails part-way

Fix the cause, then run **Actions → Release → Run workflow** with the tag. It runs the release again from the existing tag. Images are only tagged after CI passes, and the GitHub Release only appears once the images exist.

## Deploy key

Cut release pushes with the `RELEASE_DEPLOY_KEY` deploy key. A push made with `GITHUB_TOKEN` wouldn't start the Release workflow, and rulesets can let the key through without opening `main` to other pushes. To set it up or rotate it:

```bash
ssh-keygen -t ed25519 -N '' -C 'xseek-match release' -f release_key
gh repo deploy-key add release_key.pub -R getxseek/xseek-match -w -t release
gh secret set RELEASE_DEPLOY_KEY -R getxseek/xseek-match < release_key
rm release_key release_key.pub
```

Rulesets that keep `main` and the tags safe, each with **Deploy keys** on the bypass list:

- `main`: require a pull request and the `lint-test` and `e2e` checks, and block force pushes and deletion.
- `v*` tags: restrict creation, updates and deletion. Add repository admins to the bypass list to keep tagging by hand.
