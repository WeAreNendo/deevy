---
"@deevy/core": patch
"@deevy/sockets": patch
"@deevy/web": patch
---

Connecting a tool with credentials it refuses now says so in the tool's own words — "Linear would not take
these credentials: Invalid client: client is invalid (invalid_client)" — instead of "Internal Server Error",
for every provider, and so does **Ask who deevy is there** when a connected tool stops taking its credential.

The secret fields in every connect dialog — Linear's client and signing secrets, GitLab's tokens, Notion's
integration secret, Slack's bot token and signing secret, GitHub's webhook secret — are masked now and kept from
the browser's and password managers' autofill.

A Socket that was never finished connecting, or one that is paused, can be disconnected from its page; before,
an abandoned or refused connect stayed in the Sockets list for good.

Also: the Sockets page no longer says this deevy was built with no tools while the list is still loading, and a
Linear comment an integration brought in is always treated as a machine's, whichever shape Linear sends its
bot actor in.
