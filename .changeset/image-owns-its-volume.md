---
"@deevy/server": minor
"@deevy/adapters": minor
---

The Docker image no longer needs its volume given to uid 65532 before it starts. It starts as root, gives `/data` to 65532 when it isn't 65532's already, then runs deevy as 65532 for good, before it loads anything else. A host directory works whoever made it, and ends up belonging to 65532; a volume an older release wrote as root, or a database you restored from a backup, is taken over on the next start. Only the directory and the database's own files are changed, so the `chown` steps are gone from the docs. To keep deevy from ever starting as root, run it with `--user 65532:65532` (`runAsUser: 65532` and `fsGroup: 65532` on Kubernetes), as before: it then changes nothing, and refuses a `/data` it cannot write with the command that fixes it. A Kubernetes pod that sets `runAsNonRoot: true` must now also set `runAsUser`, and a container that drops every capability needs `--user` or `CHOWN`, `SETUID` and `SETGID` back.
