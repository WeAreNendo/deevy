---
"@deevy/core": minor
"@deevy/sockets": minor
"@deevy/web": patch
---

A Socket's page now shows the address the tool delivers to, and a GitHub App can be pointed at it again from
there — **Point GitHub at this address**, or `sockets.rewire` — for an instance whose address changed, such as
a laptop behind a tunnel with a new hostname. `sockets.list` carries each Socket's `inboundUrl`.

Fixed: the Gate, Run and record pages no longer grow wider than a phone's screen when a Proposal has a long
line, and on a wide screen the Proposal is the main column again with the ruling card beside it. An Inbox row
and a Run's preview quote a Proposal as words rather than as markdown, and a Run's own page renders it. In
development, deliveries to a Socket's address reach the server through the SPA's dev server.
