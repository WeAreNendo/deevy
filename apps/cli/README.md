# deevy from a terminal

```bash
npm install -g @deevy/cli
deevy login https://deevy.example.com
deevy issues list --project-key DEV
```

`deevy` talks to a [deevy](https://github.com/WeAreNendo/deevy) instance over its API, as the Human you
signed in as. Almost every command is generated from deevy's own operation registry, so the CLI has the same
surface the API and the MCP tools have, and an operation deevy gains is a command without a release of this.

## Signing in

`deevy login <url>` opens a browser, takes the consent you would give any other client, and keeps a token at
`~/.config/deevy/<scheme>_<host>.json` — mode 0600, one file per instance, so signing into a second deevy
does not sign you out of the first. `deevy logout` forgets it; the consent stays listed in deevy's Settings
until a Human revokes it there, because revoking one wants a browser session and a CLI has none.

Set `DEEVY_API_KEY` and the CLI acts as that **Agent** instead, which is what a script wants. It wins over a
signed-in Human, and `deevy whoami` says which of the two answered — that changes what the CLI may do.

| Variable          | What it does                                                                                        |
| ----------------- | --------------------------------------------------------------------------------------------------- |
| `DEEVY_URL`       | The instance every command talks to, when one is not named. `--deevy-url` overrides it per command. |
| `DEEVY_API_KEY`   | An Agent's key. The CLI acts as that Agent.                                                         |
| `DEEVY_WEB_URL`   | Where the SPA is, if that is not where the API is. Only `deevy gates open` uses it.                 |
| `XDG_CONFIG_HOME` | Where the token is kept. Defaults to `~/.config`.                                                   |
| `NO_COLOR`        | Turns colour off. It is off for a pipe either way.                                                  |

## What it can and cannot do

Everything the Human or Agent you are signed in as may do — with four exceptions, which the CLI explains
rather than relaying as a refusal:

- **`gates approve` and `gates reject`.** A Gate is ruled by a Human in deevy's own browser and by nothing
  else, whatever the CLI is signed in as. `deevy gates open DEV-42` puts it in front of one.
- **`oauth-clients list` and `oauth-clients revoke`.** A delegated credential cannot enumerate or revoke the
  consents that delegated it.

## Reading the answers

A list is a table, a single thing is its fields, and `--json` on any command gives you the exact answer for a
script. `deevy events watch` follows the Event log as it happens and resumes where it left off.

## Version

`@deevy/cli`'s version is deevy's: the same number as the instance and the image. A CLI newer than the
instance it is pointed at asks that instance what it can do and says so by name when a command is not among
them, so a mismatch is a sentence rather than a failure.
