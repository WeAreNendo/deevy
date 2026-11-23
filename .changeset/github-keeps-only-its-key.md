---
"@deevy/sockets": patch
---

A GitHub Socket created from the App manifest now keeps only two of the secrets GitHub hands back, the App's private key and its webhook secret, beside the App's id and slug. GitHub's answer also carries the App's client ID and client secret, which deevy used to seal and keep, though it never read them: they are for signing in through the App, and deevy signs Humans in through the separate OAuth App you set in `GITHUB_CLIENT_ID`, or another provider. A 0.11 database, and a dump of one, still hold that client secret, sealed. To be rid of it, generate a new client secret in the App's settings on GitHub and delete the old one; nothing in deevy uses either.
