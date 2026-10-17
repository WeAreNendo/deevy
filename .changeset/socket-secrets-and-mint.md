---
"@deevy/core": patch
"@deevy/sockets": patch
"@deevy/web": patch
---

A Socket's answers no longer carry its previous webhook secret, which every `sockets.*` answer and the API reference included, sealed but still a stored secret, once the secret had been replaced; nor when it was replaced, which nothing read. **Mint a webhook secret** (`sockets.rotate`) now keeps the old secret working for a day, as pasting a new one already did, so deliveries signed with it are not refused while you paste the new one into the tool. And `sockets.rotate` now refuses a Slack, Linear or Notion Socket, from the API and the CLI too, saying what to do instead: Slack and Linear make their own signing secret and take none typed in, so you paste the tool's new one on the Socket's page; Notion signs with its verification token, which a minted secret would have replaced. `sockets.providers` says which way each tool works, in a new `webhookSecretFrom` field (`either`, `tool` or `handshake`), and the Socket's page offers what that says. A Socket module of your own must now declare `webhookSecretFrom`.
