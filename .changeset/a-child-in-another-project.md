---
"@deevy/core": minor
---

A sub-issue may now live in a different Project from its parent. Work has dependencies that run across
Projects — the piece that has to land in the API before the piece in the app can — and a parent link that
stopped at the boundary did not remove the dependency, it moved it onto somebody writing it down twice. An
Agent may open a child in any Project it was granted, and the child follows that Project's Workflow and its
Gates. A parent in a Project you cannot see is not shown to you, and an Issue whose parent is hidden that way
cannot be moved out of its tree.

This also fixes an Issue's parent and children being labelled with the wrong key. They were named after the
Project of the Issue you were looking at, which was invisible while a tree could not cross one.
