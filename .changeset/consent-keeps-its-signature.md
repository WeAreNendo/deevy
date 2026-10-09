---
"@deevy/web": patch
---

Allowing an MCP client or `deevy login` on the consent page works again: the page kept only one value of a query parameter the sign-in server repeats, so every consent failed with `invalid_signature`. Every value of a repeated parameter is kept now.
