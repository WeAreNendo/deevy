---
"@deevy/server": minor
---

The deevy image now runs as an unprivileged user on Google's distroless Node base. It carries Node, deevy's bundle and nothing else — no shell, no package manager, no `apt`, and no way to get a prompt inside the container. It is about a third smaller for it.

**Upgrading an existing instance needs one command first.** Everything on your volume was written as root, and the new image runs as uid 65532, so it can read the database but not write to it. With the container stopped:

```bash
docker run --rm -v deevy-data:/data alpine chown -R 65532:65532 /data
```

Do this **before** starting the new image, and do not take a running container as proof you did: deevy writes nothing at startup that it has not already written, so on a root-owned volume it starts, answers `/healthz`, reports `healthy`, and then fails on the first thing anyone tries to save. The command is idempotent; run it if you are unsure.

A fresh install needs nothing — a new named volume takes its ownership from the image. A host directory you bind-mount does not, so `chown -R 65532:65532` that before the first start.

**The image now carries its own healthcheck**, so `docker ps` reports `healthy` and Compose's `depends_on: condition: service_healthy` works without a healthcheck of your own, on whatever `DEEVY_PORT` you set. The one in the published `docker-compose.yml` has been removed. If you have a copy of the old file, delete the `healthcheck:` block under the `deevy` service — it calls `node` by name, and the new image has no shell and no `PATH` entry to find it with, so it would report `unhealthy` forever and hold back anything waiting on it.

Backups are unchanged: `sqlite3` was never in this image and still is not, so the sidecar recipes in `docs/OPERATIONS.md` are still how you take one. **Restoring now needs one more line** — a file copied in by a root sidecar has to be given to uid 65532 before deevy can write it. The recipe in the docs does that.

If you already ran the image with `--user` or a `user:` in Compose, it still works; that is now the default rather than something you have to ask for.
