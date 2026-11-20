# deevy from a terminal

```bash
npm install -g @deevy/cli
export DEEVY_URL=https://deevy.example.com DEEVY_API_KEY=deevy_sk_...
deevy whoami
deevy runs list
```

`deevy` talks to a [deevy](https://github.com/WeAreNendo/deevy) instance over its API, as the **Agent** whose
key is in `DEEVY_API_KEY`. It is an Agent's tool, for a script or a loop that works an Issue: it reads
records, adds Links, asks at a Checkpoint and drives its Run, exactly as an MCP client holding the same key
would. Every command but two is generated from deevy's own operation registry, so the CLI has the surface an
Agent has on the API and the MCP tools, and cannot drift from them. The generating happens when the CLI is
built, so a new operation arrives here in the next release of this. Until then, a command this CLI has that
your instance does not is refused by name rather than failing at it.

## The key

An Agent's key is issued by its Sponsor in deevy, under Settings › Agents, and shown once. Put it in
`DEEVY_API_KEY`; the CLI reads it on every run and stores nothing. Without one the CLI is nobody, and a key
that is not an Agent's is refused. A Human signs in to deevy in a browser, and has no key.

A URL may include a path, for a deevy that lives under one — a hosted Workspace, or one served behind a
proxy:

```bash
DEEVY_URL=https://app.deevy.dev/acme deevy whoami
```

Every command then talks to that deevy under its path.

| Variable          | What it does                                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------------------------ |
| `DEEVY_URL`       | The instance every command talks to, path included, when one is not named. `--deevy-url` overrides it per command. |
| `DEEVY_API_KEY`   | An Agent's key. The CLI acts as that Agent.                                                                        |
| `DEEVY_WEB_URL`   | Where the SPA is, if that is not where the API is. Only `deevy gates open` uses it.                                |
| `XDG_CONFIG_HOME` | Where the CLI caches what each instance can do, for a day. Defaults to `~/.config`.                                |
| `NO_COLOR`        | Turns colour off. It is off for a pipe either way.                                                                 |

## What it can and cannot do

Everything an Agent may do, and nothing else. What only a Human may do — issuing a key, connecting a tool,
inviting a Member, ruling on a Gate — is done in deevy's own pages, and is no command here. A Gate is ruled
by a Human, in deevy, in the tracker or in the Project's chat channel; `deevy gates open DEV-42` prints the
link that puts it in front of one.

The full list of commands is at [docs.deevy.dev/reference/cli](https://docs.deevy.dev/reference/cli/).

## Reading the answers

A list is a table, a single thing is its fields, and `--json` on any command gives you the exact answer for a
script.

## Version

`@deevy/cli`'s version is deevy's: the same number as the instance and the image. A CLI newer than the
instance it is pointed at asks that instance what it can do and says so by name when a command is not among
them, so a mismatch is a sentence rather than a failure.
