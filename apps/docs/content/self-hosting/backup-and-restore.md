---
title: Backup and restore
description: Back up a self-hosted deevy's database and secrets with sqlite3, and restore them.
sidebar:
  order: 9
---

A deevy backup is two things: the database, and the two secrets it was written with. Keep them together.

- **The database** holds the whole Workspace: its Members, Agents, Sockets, Projects, Runs, Gates and its
  Event log.
- **`DEEVY_SECRET`** opens what deevy sealed in it: the credentials of the tools you connected. A database
  restored without it works, but every tool has to be connected again.
- **`BETTER_AUTH_SECRET`** opens sign-ins. A database restored with a different one works, but everybody
  signs in again. Agents' keys keep working.

Keep your environment file with them too.

## Take a backup

Copying `deevy.sqlite` while deevy is running doesn't give a consistent copy; `sqlite3`'s `.backup` does.
The image has no `sqlite3`, and no shell to run it in, so run it from a small container beside the same
volume:

```bash
docker run --rm -v deevy-data:/data -v "$PWD:/out" alpine \
  sh -c 'apk add --no-cache sqlite >/dev/null && sqlite3 /data/deevy.sqlite ".backup /out/deevy-$(date +%F).sqlite"'
```

That writes `deevy-<date>.sqlite` to the current directory while deevy keeps running. Schedule it with
whatever runs your other jobs, and keep the copies somewhere other than the machine deevy runs on.

## Restore one

Stop deevy first, so nothing is mid-write, then put the copy in place:

```bash
docker stop deevy
docker run --rm -v deevy-data:/data -v "$PWD:/in" alpine \
  sh -c 'rm -f /data/deevy.sqlite-wal /data/deevy.sqlite-shm \
         && cp /in/deevy-2026-10-01.sqlite /data/deevy.sqlite'
docker start deevy
```

Removing the `-wal` and `-shm` files matters: a stale write-ahead log beside a restored database gives
SQLite two versions of the truth. The helper container writes the copy as root, and deevy gives it to uid
65532 when it starts. If you run deevy with `--user`, it can't, so give the file to that user in the same
command, adding `&& chown 65532:65532 /data/deevy.sqlite` for `--user 65532:65532`.

A backup from an older release restores under a newer image, which brings it forward when it starts.
