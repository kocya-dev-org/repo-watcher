---
name: extension-version-bump
description: Update the repo-watcher Chrome extension version when the user asks to bump it to a specified version such as 1.2.0.
---

# Extension version bump

When the user asks to raise the extension version to `x.y.z`, apply that version to the two release metadata fields in this repository:

- `package.json` → top-level `version`
- `public/manifest.json` → top-level `version`

Use the version the user supplied; do not infer or increment it. If no target version is stated, ask for it. Change only those fields for this request. In particular, do not change version-like values in `test/releaseCheck.spec.ts`, which are test fixtures for version comparison. Do not change `package-lock.json` unless the user explicitly includes it in scope.

Before editing, inspect the current values and working tree. Preserve unrelated existing changes. After editing, check both JSON files parse, confirm both fields equal the requested version, and inspect the diff to ensure no unrelated files or test fixtures changed. Run `npm run build` and `npm run test`; report each result. If either fails due to existing unrelated work, identify the error and leave that work untouched rather than broadening the version bump.
