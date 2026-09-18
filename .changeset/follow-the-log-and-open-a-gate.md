---
"@deevy/cli": minor
---

`deevy events watch` follows the Event log as it happens, resuming from where it got to and reconnecting when a stream ends — which is what a Cloudflare-hosted instance does after every poll, so a watch that did not reconnect would quietly stop after a few seconds there while working fine against a Docker one. `--after` resumes from an Event you name, `--project-id` narrows it, `--json` gives you one Event per line for a script, and Ctrl-C ends it.

`deevy gates open DEV-42` puts a Gate in front of the Human who can rule it. `gates approve` and `gates reject` still exist and still refuse, because a Gate is ruled in deevy's own browser and by nothing else — this is the verb that does something about that rather than being told about it. The URL goes to stdout so it can be piped somewhere; the explanation does not.
