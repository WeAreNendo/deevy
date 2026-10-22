---
"@deevy/web": patch
---

The **Signed in, not yet a Member** page no longer tells people to ask for a rule this deployment can't have. It named a GitHub organization and a GitLab group whatever the deployment signs in with, so deevy Cloud, which has no GitLab sign-in, sent people to ask for a GitLab group rule. It now names the same rules **Settings › General** offers: an email domain always, a GitHub organization where people can sign in with GitHub, and a GitLab group where they can sign in with GitLab.
