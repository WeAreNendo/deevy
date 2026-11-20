---
title: Bringing a Workspace from deevy Cloud
description: Export a Workspace from deevy Cloud and load it into a Docker image of your own, then point your tools and Agents at its new address.
sidebar:
  order: 11
---

A Workspace on deevy Cloud can move to a deevy you host, with everything in it: its Members and how they
sign in, its Agents and their keys, its Sockets and their credentials, its Projects, Runs and Gates, and
its Event log, which carries on numbering from where it was.

You need deevy ready to start: read [Run the Docker image](/self-hosting/docker/), and stop before the
first sign-in.

## Export it

1. In deevy Cloud's console at [app.deevy.dev](https://app.deevy.dev/), open the Workspace.
2. Under **Take it home**, choose **Export**.

Your browser saves `deevy-<address>-<date>.json`. It holds three things you need:

- `dump`, the Workspace's whole database as SQL.
- `betterAuthSecret` and `deevySecret`, the two secrets its sign-ins and its tools' credentials were sealed
  with. They exist nowhere else, and nothing can replace them: without `deevySecret`, every tool has to be
  connected again.

Keep the file as safely as a password. The export is the Workspace at the moment you took it; anything your
team does on deevy Cloud afterwards stays there, so export when the team has stopped working in it. See
also [Export and leave](/cloud/export-and-leave/).

Take the three out of the file, for example with `jq`:

```bash
jq -r .dump deevy-acme-2026-10-16.json > workspace.sql
jq -r .betterAuthSecret deevy-acme-2026-10-16.json   # your BETTER_AUTH_SECRET
jq -r .deevySecret deevy-acme-2026-10-16.json        # your DEEVY_SECRET
```

Use the two secrets wherever the setup pages ask you to generate new ones. Leave `DEEVY_ADMIN_EMAIL`
unset if you like: the Workspace and its admins come with the dump.

## Import it

The image carries the import as a second script beside the server. Run it once, on a new volume, before
deevy ever starts on that volume.

1. Write your `deevy.env` as in [Run the Docker image](/self-hosting/docker/#start-it), with
   `BETTER_AUTH_SECRET` and `DEEVY_SECRET` set to the export's values.
2. Import:

   ```bash
   docker volume create deevy-data
   docker run --rm -i -v deevy-data:/data --env-file deevy.env \
     ghcr.io/wearenendo/deevy:latest dist/import.mjs - < workspace.sql
   ```

   The `-` reads the dump from standard input. Use an image at least as new as the release your Workspace
   ran on deevy Cloud, which the foot of its Settings pages shows: a dump from a newer release than the
   image is refused.

3. Start deevy on that volume, as in [Run the Docker image](/self-hosting/docker/#start-it).

What the import does, in order:

- **It refuses a database that already holds anything.** A Workspace is never merged into another. If you
  started deevy on the volume first, use a new volume, or stop deevy, remove `deevy.sqlite` and its `-wal`
  and `-shm` files, and import again.
- **It builds the database beside where it will live**, checks that it holds exactly one Workspace whose
  rows all fit together, and only then moves it into place, so a failure leaves nothing behind.
- **It migrates it**, exactly as an upgrade would, if the dump is from an older release, and names each
  migration it applied. A dump from before 0.12 is refused, since 0.12 started on an empty database
  ([Upgrading](/self-hosting/upgrading/#from-011-or-earlier)).
- **It checks `DEEVY_SECRET`** by opening everything sealed with it, and says plainly which values it
  could not open.
- **It prints what it imported**, and what to point at the new address, with each Socket's own address
  filled in.

## Point everything at the new address

Your Workspace's address changes from `https://app.deevy.dev/<address>` to your `BETTER_AUTH_URL`, and
deevy can't tell the rest of the world. In this order:

| What              | What to change                                                                                                                                                                                                                                                                     |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Signing in        | deevy Cloud's sign-in apps call back to app.deevy.dev only. Register your own for each provider you offer, with `${BETTER_AUTH_URL}/api/auth/callback/<provider>`; see [Sign-in providers](/self-hosting/sign-in-providers/). Everybody signs in again and finds their own Member. |
| Agents            | Each one's MCP endpoint and `DEEVY_URL`, to the new address. Their API keys keep working.                                                                                                                                                                                          |
| A GitHub Socket   | Choose **Point GitHub at this address** on the Socket's page in **Settings › Sockets**. In the GitHub App's own settings, set the **Setup URL** to `${BETTER_AUTH_URL}/hooks/<socket>/setup`.                                                                                      |
| A Linear Socket   | In the OAuth application: the webhook URL, `${BETTER_AUTH_URL}/hooks/<socket>`, and the callback URL, `${BETTER_AUTH_URL}/hooks/<socket>/setup`.                                                                                                                                   |
| A GitLab Socket   | On every project or group it is bound to, the webhook's URL, `${BETTER_AUTH_URL}/hooks/<socket>`. The secret token stays.                                                                                                                                                          |
| A Notion Socket   | On the connection's **Webhooks** tab, a new subscription to `${BETTER_AUTH_URL}/hooks/<socket>`, verified with the token the Socket's page shows. Then delete the old one.                                                                                                         |
| A Slack Socket    | Nothing: Slack never calls deevy. If the app still has **Interactivity** or a `/deevy` command from an earlier manifest, turn them off.                                                                                                                                            |
| Outgoing webhooks | Nothing: they name other services' addresses, not deevy's.                                                                                                                                                                                                                         |

The import prints this list for your own Sockets, with their addresses filled in. Only GitHub lets deevy
move its webhook itself; every other tool keeps it in its own settings. Until a tool is pointed at the new
address, your deevy hears nothing from it, and what the tool sent in between is not replayed: where the tool
can send a delivery again, such as **Redeliver** on a GitHub App's recent deliveries, that is how to catch
one up.

## Delete the copy you left

Once your own deevy is up and your team is working in it, delete the Workspace on deevy Cloud, so nothing
still pointed at the old address, such as an Agent somebody forgot, goes on working against the copy. See
[Delete a Workspace](/cloud/delete-a-workspace/).
