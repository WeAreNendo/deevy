---
"@deevy/cli": minor
---

The CLI is on npm:

```bash
npm install -g @deevy/cli
deevy login https://deevy.example.com
```

It is the only package deevy publishes — everything else in the workspace is part of an instance, and this is the part you install. Its version is deevy's, so `@deevy/cli@0.9.0` is the same number as the image and the instance.

The tarball is the bundle and the readme, three files and no dependencies to resolve: `vp pack` inlines everything. It is published from the release tag with npm provenance, so the workflow, the commit and the repository that built it are recorded and anybody can check them.

**One thing an admin has to do once**: add an `NPM_TOKEN` secret with publish rights to the `@deevy` scope. Without it the release still tags, still writes its notes and still pushes both images — only this job fails.
