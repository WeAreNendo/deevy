---
"@deevy/cli": minor
---

Every operation deevy has is now a command. `deevy issues create --project-key DEV --title "..."`, `deevy issues move DEV-42 --state-id ...`, `deevy runs list`, and ninety more — none of them written by hand. The command name, its help text, which arguments are positional and which are flags, what an enum accepts and what is required all come from the same definition the REST route and the MCP tool come from, so an operation added to deevy is a command with no CLI change at all.

Path parameters are positional and everything else is a flag: `deevy issues get DEV-42`, `deevy issues list --project-key DEV --assignee-kind agent`. A list is one flag given more than once. `--json` is on every command.

Four operations answer with an explanation instead of a request. `gates approve` and `gates reject` are a Human's, in a browser, and no CLI, key or Agent can rule a Gate whatever it is signed in as. `oauth-clients list` and `oauth-clients revoke` want a Human signed in to deevy itself, because a delegated credential should not be able to list or revoke the consents that delegated it. The CLI says which of the two rules it hit rather than passing back a bare `FORBIDDEN`.

It also refuses before asking when it already knows the answer: an operation an Agent may not call says that `DEEVY_API_KEY` is why, and one only an Agent may call says to set it.

When deevy refuses input, you get the reason the schema wrote — "Two to six uppercase letters, as in DEV", against the flag you typed — rather than "Input validation failed".

Point a command at an instance with `--deevy-url`, or set `DEEVY_URL` once.

The Event stream is not a command yet.
