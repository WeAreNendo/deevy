---
"@deevy/core": patch
"@deevy/web": patch
---

Settings › General offers a GitHub organization rule only when your team can sign in here with GitHub, and a GitLab group rule only when it can sign in with GitLab: each is checked against the account somebody signed in with on that forge, so without that sign-in it let nobody in. A rule you saved before its provider was taken away stays listed, marked as letting nobody in until people can sign in with that provider again. `allowlist.add`, and with it `deevy allowlist add`, now refuses such a rule with `PRECONDITION_FAILED` and a message saying why, where it used to save it.
