# Build with the repository root as context:
#   docker build -f apps/server/Dockerfile -t deevy .
FROM ghcr.io/voidzero-dev/vite-plus:0.3.0 AS build
# The image runs as the unprivileged `vp` user; give it the sources.
WORKDIR /src
COPY --chown=vp:vp . .
RUN vp install --frozen-lockfile
# Every package but the docs site (apps/docs), which is its own Worker and none
# of this image.
RUN vp run -F '!@deevy/docs' build
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
FROM gcr.io/distroless/nodejs24-debian13:nonroot@sha256:9eeb7f5887d0e239e78264b06f7f11d2e14be534050481803a9e4728fcdd278e AS runtime
ENV NODE_ENV=production
WORKDIR /app
# The code belongs to root and is only read. The process that runs it stops
# being root before it loads any of it, and must not be able to change what the
# next start runs as root (ADR-0033).
COPY --from=build /src/apps/server/dist ./dist
COPY --from=build /src/apps/web/dist ./web
# A fresh named volume takes its ownership from here, so the entrypoint finds
# /data already 65532's and has nothing to give. It is also what keeps
# `--user 65532:65532` working on one, for whoever will not start as root.
COPY --from=build --chown=65532:65532 /src/.empty /data
ENV DEEVY_PORT=3000 \
    DEEVY_DATABASE_PATH=/data/deevy.sqlite \
    DEEVY_WEB_DIST=/app/web
# Root, on purpose, for as long as the entrypoint takes to give /data to the
# user deevy will be — the directory's owner, or 65532 when that is root — and
# no longer: it drops before it loads the server (apps/server/src/entrypoint.ts).
# A volume or a host directory therefore needs no chown, nor does a restore. The
# base is the `nonroot` one because 65532 is its user; it is only its USER that
# is replaced here.
USER 0:0
VOLUME ["/data"]
EXPOSE 3000
# Docker runs an exec-form healthcheck directly rather than through the
# entrypoint, so the interpreter is named in full: /nodejs/bin is not on this
# base's PATH, and there is no shell for a CMD-SHELL form to use. It reads
# DEEVY_PORT rather than assuming 3000, so an instance that moves the port keeps
# a working healthcheck — which the one in docker-compose.yml did not. It runs
# as the image's user, root, and does nothing but ask.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 \
    CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:'+(process.env.DEEVY_PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
# Everything the image runs goes through the entrypoint, so
# `docker run … dist/import.mjs` gives up root as the server does. The command
# is the script alone, which the entrypoint imports once it is no longer root.
ENTRYPOINT ["/nodejs/bin/node", "/app/dist/entrypoint.mjs"]
CMD ["dist/index.mjs"]
