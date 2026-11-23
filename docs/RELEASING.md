# Releasing

Versions follow [semver](https://semver.org): `MAJOR.MINOR.PATCH`, with `-rc.N` for release candidates.

1. Set the version in `package.json` (`npm version X.Y.Z --no-git-tag-version`) and `src/version.ts`, and add a `## X.Y.Z - YYYY-MM-DD` section to `CHANGELOG.md`.
2. Merge that to `main`.
3. Tag the merge commit and push the tag:

   ```bash
   git tag -s vX.Y.Z -m "release: vX.Y.Z"
   git push origin vX.Y.Z
   ```

The [Release workflow](../.github/workflows/release.yml) then checks that the tag, `package.json`, `src/version.ts` and the changelog agree, runs CI on the tagged commit, builds amd64 and arm64 images, and publishes the GitHub Release last.

## Release notes

To write the notes yourself, create a draft release for the tag before pushing it. The workflow publishes the draft as it is. Without a draft, the notes are the version's `CHANGELOG.md` section.

## Image tags

| Release | Tags |
| --- | --- |
| `v1.2.3` | `1.2.3`, `1.2`, `1`, `latest`, `sha-<commit>` |
| `v0.2.3` | `0.2.3`, `0.2`, `latest`, `sha-<commit>` |
| `v1.3.0-rc.1` | `1.3.0-rc.1`, `sha-<commit>` |

`latest` only moves forward: a patch for an older line doesn't take it.

## If a release fails part-way

Fix the cause, then run **Actions → Release → Run workflow** with the tag. It runs the release again from the existing tag. Images are only tagged after CI passes, and the GitHub Release only appears once the images exist.
