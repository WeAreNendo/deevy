---
"@deevy/core": minor
"@deevy/web": minor
"@deevy/db": patch
---

An Agent that splits work into sub-issues can no longer split it forever. Your Workspace now carries three
limits — how many sub-issues one Issue may have, how many levels deep they may go, and how many may be open
in one tree at once — and an Agent that reaches any of them is refused, with a line in the log so you can see
that a number shaped the work rather than the Agent. They start at 20, 3 and 50, an admin changes them under
Settings › Workspace, and they never apply to a Human.
