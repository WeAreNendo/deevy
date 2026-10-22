# The image makes its volume its own

Since 0.8 the deevy image has run on a distroless base as uid 65532 (#65), and a fresh named volume worked
with nothing done to it, because the image's own `/data` belongs to 65532 and a new volume copies it.
Everything else needed a `chown` first: a host directory, a volume an earlier release had written as root,
and a database restored by a root sidecar, which is how the backup recipe restores one. The public docs
asked for one on three pages, and the preflight in `openDatabase` names one when it refuses to start. An
image that needs its volume given to a particular uid before it will start is unusual enough that the first
self-hoster to read the Docker page asked why.

Running as 65532 was never what protected the Workspace. A process that could write the database could
already read `DEEVY_SECRET` and every credential it unseals, and could rewrite its own code, which the image
gave to 65532 too. What a non-root process protects is the host: root in a container is root on the kernel
unless the daemon remaps users, and holds Docker's default capabilities; several container escapes have
needed exactly that. That protection is worth keeping. It only has to hold while deevy is listening.

## The decision

**The image starts as root, gives the database's directory to the user deevy will be, becomes that user for
good, and only then loads the server.** The entrypoint, `apps/server/src/entrypoint.ts`, is node builtins and
`ownership.ts` and nothing else, and imports the script it is handed (`dist/index.mjs`, or `dist/import.mjs`
when `docker run` names it) once root is gone.

- **Who it becomes**: the owner of the directory when that is not root, with their group (a group of root is
  not taken; their own number stands in). A host directory somebody made stays theirs, and deevy writes as
  them; a fresh named volume belongs to 65532. When the directory is root's, as a host path Docker created
  or a pre-0.8 volume is, it is given to 65532 and deevy runs as 65532.
- **What it gives**: that directory when root owns it, and the database's own files — the file, `-wal`,
  `-shm`, `-journal` — when somebody else wrote them. Nothing else in the directory. Nothing that is a link
  or has a second name, and never the directory the code is in or anything above it, because this runs as
  root over a directory that a process which is not root could write, and whoever owned the code could
  change what the next start runs as root. A `chown` it may not make, as on a root-squashed NFS export, is
  logged and passed over; the user it becomes finds out from `openDatabase` whether that matters.
- **The drop**: `setgroups`, `setgid`, `setuid`, then a `setuid(0)` that must fail. A drop that does not
  happen is an exit, never a server running as root.
- **Started as anyone else** (`--user`, a Kubernetes `runAsUser`), the entrypoint changes nothing and runs
  the script as that user. That is the way to never be root at all, and the preflight still refuses a
  directory that user cannot write and names the `chown` that fixes it.
- **The code belongs to root.** `/app` is no longer copied in as 65532's, so the process cannot rewrite what
  it runs, the entrypoint included.

## How it is held

- `tests/ownership.test.ts` asks every decision of a file system played by a map, without root: a fresh
  volume, a volume root wrote, a host directory, a restore, a link and a second name, the code's
  directory, a `chown` refused.
- `tests/image.test.ts` reads the Dockerfile: `USER 0:0`, the entrypoint, the command, the code left to
  root, and no `chown` in any command the docs give.
- `scripts/smoke-image.ts`, in CI's `images` job, runs the image: a fresh volume serves as 65532; a volume
  root wrote starts, ends up 65532's and is served as 65532; a volume owned by 4321 is served as 4321 and
  its database written as 4321; `--user 4242:4242` on a volume it cannot write refuses and names the
  `chown`; `dist/import.mjs --help` runs through the entrypoint with its argument. Who the server is comes
  from `docker top`, the kernel's answer, for the container's own pid.

## Why not the alternatives

**Keep 65532 and document `--user "$(id -u):$(id -g)"` for host directories.** It already works, since the
preflight checks writability and not the uid. But it moves the ceremony rather than removing it, a restore
still needs a `chown`, and the uid is still something a reader has to understand before the first start.
Kept, as the way to never start as root.

**Run as root throughout.** The simplest image, and what many are. It gives up the only thing the uid
protects. Refused.

**`PUID` and `PGID`, the linuxserver.io convention.** Two more settings for what the directory's owner
already says. Taking the owner covers the case they exist for without a word of configuration.

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
- **Rolling back to a release before 0.12** on a host directory deevy adopted for a user other than 65532
  needs that directory given to 65532 first. Those releases run as 65532 and give nothing away, and their
  preflight names the command.
- **Rootless Podman**, without `--userns=keep-id`, shows a directory its user made as root's inside the
  container, so deevy gives it to 65532, which the host sees as a subordinate uid. That is what the earlier
  docs asked for by hand.
