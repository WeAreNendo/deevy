---
"@deevy/core": minor
"@deevy/db": minor
"@deevy/web": minor
"@deevy/cli": minor
---

**The screens deevy's new shape needs: a place to rule, a place to watch, and a read-only list of the work.**

**Home is what needs you.** A Gate awaiting your ruling first, a Run awaiting your answer second, your Agents' Runs after that, and "Nothing needs you" when that is true. A Run stopped at a Gate is counted once, under the Gate, because it is one thing to do and not two.

**`/gates/<id>` is the ruling screen**, and the link an Agent hands a Human. It shows the Proposal rendered, the record's key linking back to the tracker, the count said out loud ("1 of 2"), and each Ruling with the door it came through. `⇧A` and `⇧R` choose a ruling and put the cursor in the Note; `⌘↵` commits it. When the Checkpoint will not take a ruling from you, the card says why before you click — the reason is the server's own, so the disabled button and the refusal behind it cannot disagree.

**`/runs` is the feed** of what your Agents have been doing, with status, Agent and "mine" in the URL, and a waiting Run one click from where it is answered. `/runs/<id>` is one Run: its Activity in time order and the Gates it asked for.

**`/work` lists every record deevy has projected**, read-only, with filters in the URL and every key linking out to the tracker. `/work/<id>` shows what deevy knows — the Runs, the Gates, the links, the Events — and offers nothing to edit, because the record belongs to the team's own tool. Where a composer used to be there is a link: "Read the conversation on GitHub".

**The Inbox opens the ruling** in its right pane for a `gate_awaiting` row, focused and ready; anything else opens the record.

New in the API for those screens: `runs.list` answers a Human the Workspace's Runs, takes `mine`, and says which Gate each Run is waiting at; `gates.list` filters by Run or by record; a Gate's answer carries where the Human reading it stands and which tool each Ruling came through.

`deevy gates open <gate>` takes a Gate's id or the tracker's key for a record waiting at one, and opens the ruling screen. There is no `approve`: a Gate is ruled in deevy's own browser, by a Human, and nowhere else.
