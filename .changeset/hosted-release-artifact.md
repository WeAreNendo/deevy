---
"@deevy/server": minor
---

Every release now carries the many-Workspaces Worker ready to deploy: `deevy-hosted-<version>.tar.gz` on the GitHub Release, with its `.sha256` and a build provenance attestation (`gh attestation verify deevy-hosted-<version>.tar.gz --repo WeAreNendo/deevy --signer-workflow WeAreNendo/deevy/.github/workflows/hosted-release.yml`). Inside are the bundle and its source map, the SPA, a `wrangler.json` with what only the deployer knows left as marked blanks (`<<HOST>>`, `<<DIRECTORY_KV_ID>>`, `<<CONSOLE_SERVICE>>`), and a `manifest.json` naming the version, the commit, the compatibility date and flags, the Durable Object class and its migrations, every secret and variable the Worker reads, and the SHA-256 of every file. A hosted Workspace's `Platform.status` reports the version its build was made from. See "The many-Workspaces Worker" in OPERATIONS.md.
