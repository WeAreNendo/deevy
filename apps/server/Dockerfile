# Build with the repository root as context:
#   docker build -f apps/server/Dockerfile -t deevy .
FROM ghcr.io/voidzero-dev/vite-plus:0.3.0 AS build
# The image runs as the unprivileged `vp` user; give it the sources.
WORKDIR /src
COPY --chown=vp:vp . .
RUN vp install --frozen-lockfile
RUN vp run -r build
# The runtime stage has no shell to make a directory with, and this stage is not
# root so it cannot give one away either — but `COPY --chown` sets ownership in
# the layer itself, and an empty directory is all /data has to start as.
RUN mkdir -p /src/.empty

# The server bundle is self-contained (no native modules, ADR-0008), so the
# runtime image needs a Node and nothing else: no package manager, no apt, no
# shell for anything that gets in to use. Pinned by digest as well as by tag,
# because the tag moves whenever the base is rebuilt and a release that cannot
# say which bytes it shipped is not one. `docker buildx imagetools inspect` on
# the tag prints the digest to move it to.
FROM gcr.io/distroless/nodejs24-debian13:nonroot@sha256:bb6b03d81066993293a10feda7250e8e1cc034035fe9b61cfceededa7c8bf04d AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=65532:65532 /src/apps/server/dist ./dist
COPY --from=build --chown=65532:65532 /src/apps/web/dist ./web
# Docker creates a missing mount point as root, and this process is 65532: it
# would then be unable to create the database — or, far quieter, unable to
# create the -wal beside it, because SQLite does not fail a `journal_mode` it
# cannot honour, it just stays in `delete` mode (packages/adapters/src/node/db.ts).
# A fresh named volume takes its ownership from here; an upgrading instance's
# existing volume does not, which is the one command docs/OPERATIONS.md asks for.
COPY --from=build --chown=65532:65532 /src/.empty /data
ENV DEEVY_PORT=3000 \
    DEEVY_DATABASE_PATH=/data/deevy.sqlite \
    DEEVY_WEB_DIST=/app/web
USER 65532:65532
VOLUME ["/data"]
EXPOSE 3000
# Docker runs an exec-form healthcheck directly rather than through the
# entrypoint, so the interpreter is named in full: /nodejs/bin is not on this
# base's PATH, and there is no shell for a CMD-SHELL form to use. It reads
# DEEVY_PORT rather than assuming 3000, so an instance that moves the port keeps
# a working healthcheck — which the one in docker-compose.yml did not.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 \
    CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:'+(process.env.DEEVY_PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
# The entrypoint is node itself, so this names the script alone: `["node", ...]`
# here would run `node node dist/index.mjs`.
CMD ["dist/index.mjs"]
