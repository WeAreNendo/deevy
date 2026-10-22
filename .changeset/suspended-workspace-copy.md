---
"@deevy/hosted": patch
---

A suspended hosted Workspace no longer says its owner can bring it back from the console, which was true only while its owner was deleting it: when deevy Cloud suspends a Workspace, only support can resume it. Its pages now say **This Workspace is suspended: nobody can use it until it is resumed. Ask its owner, who can see why in the console or write to support@deevy.dev.**, with the console and the address as links, and so does every request in the minute after a suspension while the address still points at the Workspace. A tab left open on it is closed with that first sentence.
