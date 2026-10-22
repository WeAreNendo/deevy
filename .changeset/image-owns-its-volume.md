---
"@deevy/server": minor
"@deevy/adapters": minor
---

The Docker image no longer needs its volume given to uid 65532 before it starts. It starts as root, makes `/data` its own, then gives up root for good before it loads anything else, and runs as the owner of `/data`, or as 65532 when that owner is root. A host directory you made works as it is and stays yours, and a volume an older release wrote or a database you restored from a backup is taken over on the next start, so the `chown` steps are gone from the docs. To keep deevy from ever starting as root, run it with `--user 65532:65532` (`runAsUser: 65532` and `fsGroup: 65532` on Kubernetes), as before: it then changes nothing, and refuses a `/data` it cannot write with the command that fixes it. A Kubernetes pod that sets `runAsNonRoot: true` must now also set `runAsUser`. Going back to an earlier release on a host directory owned by a user other than 65532 means giving it to 65532 first.
