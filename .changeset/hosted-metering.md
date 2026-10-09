---
"@deevy/server": patch
---

The many-Workspaces Worker writes one Workers Analytics Engine data point per request when an `ANALYTICS` dataset is bound, indexed by the Workspace's slug, with what kind of request it was, its status and its duration, and nothing personal.
