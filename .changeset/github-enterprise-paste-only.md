---
"@deevy/core": patch
"@deevy/sockets": patch
"@deevy/web": patch
---

On a GitHub Enterprise Server or GHE.com, **Connect GitHub** now offers only **Paste an App you already have**, and says to make the App there and paste it. **Create the App on GitHub** used to be offered there too, but its form always went to github.com, and deevy's pages are only allowed to post a form to github.com, so it could not make an App anywhere else. That applies when `DEEVY_GITHUB_API` points at another GitHub, and to a GitHub Socket that names its own API address on one. `sockets.begin` now refuses a GitHub Socket in either case with `BAD_REQUEST` and says what to do instead, so a direct call no longer leaves behind a pending Socket that can never be finished. It also refuses, with `BAD_REQUEST` and the reason, a configuration the tool cannot be connected with, such as a GitHub `apiBase` that is not an http or https address, where it used to answer 500. The dialog now waits to hear which GitHub this deevy works with before it offers anything, and says so if it cannot find out. For API readers, each entry of `sockets.providers` gains `beginRefusal`: why `sockets.begin` would refuse that tool here, or null where it may start. A Socket module of your own can set `beginRefusal` to refuse it the same way. Nothing changes on github.com.
