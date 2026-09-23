---
"@deevy/core": minor
"@deevy/db": minor
"@deevy/web": minor
---

**deevy now says back, in your tracker, what happened in deevy.**

A Gate an Agent is waiting at becomes a comment on the record itself: the Checkpoint, the Proposal, the links, how to rule from there, and a link into deevy for whoever would rather. The record is labelled `deevy:awaiting-approval` while it waits, and the label comes off the moment somebody decides. The ruling is another comment, with the arithmetic — "1 of 2" — and the note whoever ruled left.

A team that never opens deevy still knows what is happening. Every comment ends `— <Agent> · <Run> · via deevy`, because the tracker shows deevy's own App as the author and a reader should not have to guess which Agent spoke.

**How much a Project says back is the Project's setting.** `gates` is the default: Gates and rulings, nothing else. `runs` adds a line when a Run starts, finishes or fails. `off` says nothing at all. It is on the Project's binding in Settings.

The derivation is the fourth in the Event log's tail and owes a delivery row exactly as a webhook does — the row is the record that something is owed, and the words are rendered when it is sent. The sweep that sends them has the same claim, backoff and retirement as the Slack and webhook arms: a Socket an operator has rested retires what it was owed rather than queueing comments against the day they resume it, and running out of attempts appends `socket.mirror_exhausted`, which is deevy admitting the two records have drifted.

**The loop this could close is tested twice.** deevy's own mirrored comment, handed straight back by the tracker, is dropped by identity and appends nothing — at the door and again here, because a loop between deevy and somebody else's API is the failure this feature is one mistake away from.

New table: `socket_mirror`, the note of what deevy posted where, so a Ruling from any door can go back and change what it finds. A Gate's ask and its ruling each cost two more statements, which the budget ratchet records.
