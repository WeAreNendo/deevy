---
"@deevy/core": minor
"@deevy/web": minor
---

**Connecting a tool, binding a Project to it, and saying what a Checkpoint wants — all without a terminal.**

**Settings › Sockets** lists what this Workspace is connected to and offers exactly the tools this build can speak, because a button for one it was not built with is a button whose only outcome is a refusal. Connecting GitHub is a form posted to GitHub carrying the manifest deevy wrote: GitHub makes the App, sends you back, and deevy seals the credentials without anybody copying a private key out of a browser. An App that already exists can be pasted instead.

**A Socket's own page** answers the question an operator actually has — is the tool telling deevy things, or is deevy having to ask? Both work, and polling is what keeps an instance no tool can reach running, but they are different situations and the page says which. Beside that: what it has said lately, a webhook secret deevy mints and shows exactly once, resting it, and disconnecting it, which drops the credential and keeps the history.

**Settings › Projects** is now the whole of what a Project is. Bind one by picking a tool, a container it offers, and a name. The container comes from the tool's own answer rather than a field somebody types, because a typo there is a Project bound to a repository that does not exist. Inside: the Agent a record nobody named goes to, the routing label, how much deevy writes back where the work lives, and where the code is. The tracker itself is stated rather than offered — moving a Project to another container would orphan every record under it.

**Checkpoints** are edited there too: a name, how many distinct Humans it wants, whether the Human the work is for may be one of them, and who may rule. The list is the policy, so it saves whole with an explicit **Save policy** rather than a field at a time — a rule about who may approve what must not be half-typed. A refusal comes back in the server's own words.

New: `sockets.providers` says which tools this deevy was built to speak. `projects.update` now takes the forge binding and the routing rule.

**Not here.** Slack's own Channel kind and the Slack direct-message preference wait for the Slack Socket, which is a later release.
