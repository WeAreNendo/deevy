---
"@deevy/agent": patch
---

Security: the reference runtime no longer runs git as root in a Run's clone. The clone, `.git` included, belongs to the coding agent, and git runs whatever a clone's configuration and hooks name, so a coding agent could plant a hook, an fsmonitor or a filter and have the runtime run it as root, with the Agent's key in its environment and the git credential in its command line, the next time the runtime committed, pushed or read what had moved. Every git command the runtime runs in a clone now runs as the coding agent's own user, with an environment that holds nothing of the runtime's and no credential, because the runtime's git proxy adds that on the way out; hooks and the fsmonitor are off for it as well. Upgrade the image. Nothing needs configuring, but if you embed the runtime and open workspaces yourself, pass the session's user to `openWorkspace`, or the runtime's git in a clone the session owns is refused rather than run as root.
