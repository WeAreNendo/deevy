---
title: Upgrading
description: Move a self-hosted deevy to a new release, and go back one release if you need to.
sidebar:
  order: 8
---

From 0.11 on, every release of deevy upgrades in place: start the new one on the data the old one left,
and it brings the schema forward. And every release still runs on the schema the next one leaves, so going
back one release needs no restore. The one exception is 0.12, which starts on an empty database
([below](#from-011-or-earlier)).

## Where releases come from

Each release is a version tag on [deevy's repository](https://github.com/WeAreNendo/deevy), such as
`v0.11.2`, with its notes on the repository's
[releases page](https://github.com/WeAreNendo/deevy/releases) and in its `CHANGELOG.md`. Read the notes
before you upgrade.

The same release publishes the Docker image, tagged `0.11.2`, `v0.11.2` and, unless it is a pre-release,
`latest`.

## Before you upgrade

Take a backup. Migrations only ever move forward, so a backup is how you go back more than one release, or
undo anything else. See [Backup and restore](/self-hosting/backup-and-restore/).

## The new image

Start the new image on the same volume. deevy applies the new release's migrations when it starts, before
it answers `/healthz`.

```bash
docker pull ghcr.io/wearenendo/deevy:<version>
docker stop deevy && docker rm deevy
docker run -d --name deevy --restart unless-stopped \
  -p 3000:3000 -v deevy-data:/data --env-file deevy.env \
  ghcr.io/wearenendo/deevy:<version>
```

With Compose, change the `image:` tag, then run `docker compose pull` and `docker compose up -d`.

If a migration fails, the server exits rather than run on a schema it doesn't expect, and its log says
why.

## Going back one release

A release's migrations only add: a table, a column that is optional or has a default, an index. What a
release stops using stays in the schema until a later release removes it. So the release before still runs
on the schema the new one leaves.

Start the previous image on the same volume. It finds the newer migrations applied, leaves them alone,
says so in its log, and runs. Starting the newer image again later picks up where it was.

One release back, not two: a release may remove what the one before it stopped using, which the one
before that still used. To go further back, restore the backup you took before upgrading. From 0.12, going
back to 0.11 is starting 0.11 on the volume you kept, since 0.11 does not run on what 0.12 writes.

## Open pages

A browser picks up the new web app on its next page load. Nobody runs the old app against the new server
for longer than a tab stays open.

## From 0.11 or earlier

0.12 starts on an empty database: there is no upgrade from 0.11 or anything before it. That release made
deevy simpler, and the data the parts it removed had kept went with them.

Start 0.12 on a new volume. Started on the volume an older release wrote, it stops before changing
anything, and its log says the database is from before 0.12. Keep that volume: it is your backup, and the
way back to 0.11.

On the new volume, sign in as the admin address, which makes the Workspace again. Then connect your tools,
set up your Projects, create your Agents and give each its new key, and let your team in with the allowlist
or an invitation. Your records arrive from the tools themselves, each the next time it changes.

## From 0.8 or earlier

0.9 starts on an empty database: there is no upgrade from 0.8 or anything before it. Start 0.9 or later on
a new volume, then connect your tools, set up your Projects and create your Agents
again; your records arrive from the tools themselves, each the next time it changes. Keep the old volume
for as long as you want what it held.

Releases up to 0.7.0 were published as `ghcr.io/mattallty/deevy`. Nothing newer is published there.
