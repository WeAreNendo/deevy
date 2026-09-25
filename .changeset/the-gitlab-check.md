---
"@deevy/sockets": patch
---

Connecting GitLab now refuses an access token without the `api` scope, and says which scope it needs, instead of
accepting one that can read but then fails at every comment, label and merge request. GitLab's refusals read as
words rather than JSON: "GitLab would not take these credentials: 401 Unauthorized (GET /user)".
