---
"@deevy/core": minor
"@deevy/sockets": minor
---

**GitLab, gitlab.com or your own, through an access token for the user deevy acts as.** Paste a personal, project or group access token with the `api` scope — one without it is refused, naming the scope — then add the webhook deevy shows (Issues events and Comments) to each project you bind, with the secret deevy mints or a signing token GitLab generates.

A Project bound to a GitLab project gets its issues and its code from it: a Run clones with the Socket's token, and deevy opens a merge request that closes the issue when it is merged, named on the record as "Merge request !7".

A Human who signs in to deevy with GitLab on the same instance (gitlab.com, or `GITLAB_ISSUER`) rules from GitLab with no linking step; anyone else links GitLab under **Settings › Identities**.

"Working in GitLab" in `docs/OPERATIONS.md` walks through it. It was checked against GitLab's docs, the Standard Webhooks reference and gitlab.com's API, but not yet walked on a GitLab instance.
