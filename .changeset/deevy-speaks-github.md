---
"@deevy/core": minor
"@deevy/db": minor
"@deevy/sockets": minor
"@deevy/server": minor
"@deevy/web": minor
---

**deevy speaks GitHub.** Connect a GitHub App and the work in your repositories becomes Issues deevy can route, run and rule on, while the records stay exactly where your team already reads them.

One App is one Socket: one webhook URL, one identity in the `deevy[bot]` account that authors every comment, and a list of installations that grows as people add it to more accounts. A repository inside one of those installations is a container, and a Project binds to one.

**A delivery arrives and becomes work.** deevy checks GitHub's signature over the raw body, writes the delivery down so a redelivery is one Run and not two, and reads the payload: an issue with the label that routes it, a comment, a sub-issue with its parent, an installation. A comment whose first line is `/approve` or `/reject <why>` is read as a Ruling, ready for the Identities that arrive in a later release. GitHub cannot assign an App, so "give this to deevy" is a label — `agent:planner` by default — or the Project's default Agent.

**Connecting is two redirects rather than a paste.** `sockets.begin` creates the Socket first, so GitHub has somewhere to send you back to; deevy trades the one-use code for the App's own id, key and webhook secret, seals them, and the Socket goes live. `/hooks/<socketId>/setup` is that door, and it takes the install callback too, checking the installation id with GitHub rather than believing the query string. A `state` signed with this instance's secret is what proves the round trip started here. Pasting an existing App's credentials into `sockets.connect` still works.

The App's private key arrives from GitHub as PKCS#1 and the Web Crypto API takes PKCS#8, so deevy wraps it rather than asking you to run `openssl` on a credential first: paste the `.pem` whole.

`issues.get` can now read the conversation from the tracker, with `comments: true`. It is off by default, because it is a request to somebody else's API: an Agent about to work a record asks for it, a list does not.

`DEEVY_GITHUB_API` points every GitHub Socket at a GitHub Enterprise Server; a Socket may still carry its own API root.
