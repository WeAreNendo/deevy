---
"@deevy/core": patch
---

The live Event stream (`events.subscribe`, which `deevy events watch` and the web app's live pages read) now leaves out invitation Events for anyone but an admin, as the Event log's pages always have. Before, any Member could follow the stream from the start and read every invitation's address and role. An admin's stream is unchanged, and a Member's stream opens with the cursor of the newest Event they may read.
