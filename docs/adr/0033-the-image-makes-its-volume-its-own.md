# The image makes its volume its own

Since 0.8 the deevy image has run on a distroless base as uid 65532 (#65), and a fresh named volume worked
with nothing done to it, because the image's own `/data` belongs to 65532 and a new volume copies it.
Everything else needed a `chown` first: a host directory, a volume an earlier release had written as root,
and a database restored by a root sidecar, which is how the backup recipe restores one. The public docs
asked for one on three pages, and the preflight in `openDatabase` names one when it refuses to start. An
image that needs its volume given to a particular uid before it will start is unusual enough that the first
self-hoster to read the Docker page asked why.

Running as 65532 was never what protected the Workspace. A process that could write the database could
already read `DEEVY_SECRET` and every credential it unseals. What a non-root process protects is the host:
root in a container is root on the kernel unless the daemon remaps users, and holds Docker's default
capabilities; several container escapes have needed exactly that. That protection is worth keeping. It only
has to hold while deevy is listening.

## The decision

**The image starts as root, gives the database's directory to 65532, becomes 65532 for good, and only then
loads the server.** The entrypoint, `apps/server/src/entrypoint.ts`, is node builtins and `ownership.ts` and
nothing else, and imports the script it is handed (`dist/index.mjs`, or `dist/import.mjs` when `docker run`
names it) once root is gone.

- **Always 65532.** Never the directory's owner: a host directory is often its operator's, and a container
  escape as their login user would own their home, their shell profile and their keys. An unused uid owns
  nothing on the host.
- **What it gives**: the directory when it is not 65532's, and the database's own files — the file,
  `-wal`, `-shm`, `-journal` — when somebody else wrote them. Nothing else in the directory.
- **How it gives**: this runs as root over a directory that a process which is not root could have
  written, so it acts on what it opened rather than on a path it checked. Each file is opened with
  `O_NOFOLLOW` and `O_NONBLOCK`, checked through `fstat` — a regular file, one name, on the directory's
  device — and given with `fchown` on that descriptor, so nothing can be swapped in between. A directory
  reached through a link anywhere in its path, by `realpath`, is left alone, and so is one on the image's
  own file system, the device `/` is on: neither deevy's code nor Node can be handed to the process that
  runs them, whatever `DEEVY_DATABASE_PATH` says. A `chown` it may not make, as on a root-squashed NFS
  export, is logged and passed over; 65532 finds out from `openDatabase` whether that matters.
- **The drop**: `setgroups`, `setgid`, `setuid`, then a `setuid(0)` that must fail, and `HOME` moved to the
  base image's `/home/nonroot`. A drop that does not happen is an exit, never a server running as root.
- **Started as anyone else** (`--user`, a Kubernetes `runAsUser`), the entrypoint changes nothing and runs
  the script as that user. That is the way to never be root at all, and the preflight still refuses a
  directory that user cannot write and names the `chown` that fixes it.
- **The code belongs to root.** `/app` is made after `USER 0:0` and the code is copied in with
  `--chown=0:0`, so the process cannot rewrite what root runs at the next start. `COPY --from` keeps the
  build stage's owner unless told otherwise, which the first version of this change missed: its code was
  uid 1000's, and a deevy running as 1000 could replace the entrypoint.

## How it is held

- `tests/ownership.test.ts` asks every decision of a file system played by a map, without root: a fresh
  volume, a volume root wrote, a host directory, a restore, a link, a second name, another device, a link
  in the path, the image's own file system, a `chown` refused.
- `tests/image.test.ts` reads the Dockerfile: `USER 0:0` before `WORKDIR`, the entrypoint, the command, the
  code copied as `0:0`, and no `chown` in any command the docs give.
- `scripts/smoke-image.ts`, in CI's `images` job, runs the image: every file under `/app` is root's and
  writable by nobody else; the entrypoint imports nothing but `node:` modules; a fresh volume is served as
  65532; a volume root wrote, and one owned by 4321 with a file of root's beside the database, end up
  65532's and are served as 65532, the other file untouched; `--user 4242:4242` on a volume it cannot write
  refuses and names the `chown`; `dist/import.mjs --help` runs through the entrypoint with its argument.
  Who the server is comes from `docker top`, the kernel's answer, for the container's own pid.

## Why not the alternatives

**Run as the directory's owner.** The first version of this change did: a host directory stayed its
maker's, and deevy wrote as them. It was friendlier and gave away exactly what the uid is kept for, since
that owner is usually a real user on the host. Refused in review.

**Keep 65532 and document `--user "$(id -u):$(id -g)"` for host directories.** It already works, since the
preflight checks writability and not the uid. But it moves the ceremony rather than removing it, a restore
still needs a `chown`, and the uid is still something a reader has to understand before the first start.
Kept, as the way to never start as root.

**Run as root throughout.** The simplest image, and what many are. It gives up the only thing the uid
protects. Refused.

**`chown -R` the whole directory.** What the docs used to ask for. It touches whatever a person keeps
there, follows nothing safely as root, and deevy needs four files at most.

**A shell entrypoint with `gosu` or `su-exec`.** The image has no shell, on purpose, and Node can make
every one of those calls itself.

## The cost, stated

- **The image says it runs as root.** A scanner that reads the image's `USER` flags it, and a Kubernetes
  pod with `runAsNonRoot: true` refuses it unless it also sets `runAsUser: 65532` (with `fsGroup: 65532` for
  the volume), which is how such a pod is usually written anyway.
- **It needs `CHOWN`, `SETUID` and `SETGID`**, which Docker grants by default. A container that drops every
  capability runs with `--user`, or it exits saying which it lacks.
- **The healthcheck and `docker exec` run as root.** Docker runs both as the image's user and neither goes
  through the entrypoint. The healthcheck is one fixed `fetch`; `docker exec` is the operator's own.
- **A host directory stops being its maker's.** It ends up 65532's, as a database image's data directory
  ends up its user's; reading it on the host takes `sudo`, or a sidecar, as a backup already does.
- **Rootless Docker and Podman** map 65532 to a subordinate uid, which is who a host directory ends up
  belonging to on the host.
- **A database elsewhere on the image's file system is never given away.** `DEEVY_DATABASE_PATH` pointing
  outside a volume gets nothing, and 65532 can write it only if the image already lets it, as `/tmp`.
