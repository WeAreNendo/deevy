---
"@deevy/core": minor
"@deevy/sockets": minor
---

Work in GitLab, gitlab.com or your own. Connect it under **Settings › Sockets › Connect GitLab** with a
personal, project or group access token (`api` scope) for the user deevy should act as, then add the webhook
deevy shows you — Issues events and Comments — to each project you bind, with the secret token deevy mints or
a signing token GitLab generates. A Project bound to a GitLab project gets both its issues and its code from
it: an issue labelled `agent:<handle>` goes to that Agent, a Run clones with the Socket's token, and deevy
opens a merge request that closes the issue when it is merged. `docs/OPERATIONS.md`, "Working in GitLab",
walks through it.

Humans rule from GitLab with `/approve` or `/reject <why>`. On the instance deevy signs people in with
(gitlab.com, or `GITLAB_ISSUER`) a Human who signs in with GitLab needs no linking step; anyone else links
GitLab under **Settings › Identities**.

A pull request's link on a record is now named in the forge's own words, so a GitLab one reads
"Merge request !7".
