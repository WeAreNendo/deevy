---
"@deevy/web": patch
---

**Settings › Event log**'s **Kind** filter now offers every family of Events the log holds. It offered ten of the seventeen, so Gate Events (`gate.*`), linked accounts (`identity.*`), sub-issue refusals (`delegation.*`) and everything about delivery (`channel.*`, `routing.*`, `webhook.*`, `email.*`) could not be picked out. The families are grouped as Records, Runs and Gates, Workspace and Delivery. The **Subject** filter now offers `gate` too. Both filters offer invitations to admins only, since the log of anybody else never holds them.
