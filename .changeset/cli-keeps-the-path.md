---
"@deevy/cli": minor
---

`deevy login` and every command keep the path of the URL they are given, so the CLI reaches a deevy that lives under a path, such as a hosted Workspace at `app.deevy.dev/acme`: `deevy login https://app.deevy.dev/acme`. Credentials saved by an older CLI still work. Signing in now checks that the authorization server it finds is the deevy it was pointed at, and when it is another — the same deevy reached by another name, say — it names that one rather than failing later at the token. `deevy whoami --json` adds `url`, the whole URL it talked to, beside `origin`. `deevy gates open` opens the Gate on the SPA `DEEVY_WEB_URL` names again, as documented.
