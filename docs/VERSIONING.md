# Versioning

Last updated: 2026-07-02

Antigravity PDF uses `x.y.z` versioning.

- `x`: major product generation. This starts at `1` and should not change
  unless explicitly requested by the project owner. Use it for a full redesign
  or similarly large product reset.
- `y`: significant feature addition. Increase this when a batch introduces a
  meaningful new user-facing capability or major tooling/product milestone.
- `z`: ordinary batch increment. Increase this for stabilization, fixes,
  tests, documentation, and other small-to-medium changes that do not introduce
  a significant feature.

Default interpretation:

- do not change `x` proactively;
- change `y` only when the batch includes a significant new feature or
  similarly important product/tooling addition;
- otherwise increment `z` for each completed batch.

Current version after the Phase 4A glyph diagnostics sidecar:
`1.6.0`.

## Local And Release Sync

The local package version lives in both `package.json` and `package-lock.json`.
Use the version sync script so they stay aligned:

```bash
npm run version:set -- 1.6.0
```

Tagged release builds should use tags shaped like `v1.6.0`. Packaging scripts
run `npm run version:sync:git` before packaging. In GitHub Actions this uses
`GITHUB_REF_NAME`, so a `vX.Y.Z` release tag updates package metadata to
`X.Y.Z`.

Local git sync only reads an exact `vX.Y.Z` tag when the working tree is clean.
This prevents normal dirty development work from being down-versioned by an
older tag that happens to point at the current base commit. Untagged or dirty
development builds leave the local version unchanged.
