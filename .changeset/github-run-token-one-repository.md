---
"@deevy/sockets": patch
---

A Run on a GitHub Project is now given a token that reaches only its Project's repository, with the App's Contents permission and nothing else. Until now a Run cloned and pushed with the App's token for its whole installation: every repository the App was installed on in that organization or account, with write access to issues and pull requests as well as code, for up to an hour, and the same token deevy made its own calls with. Each Run now gets its own token, which nothing else uses and deevy does not keep, and a Run resumed after a Gate gets a new one. deevy still opens the pull request and writes on the issue itself, with its own token, so an App made from deevy's manifest needs nothing changed. If you made your GitHub App by hand and gave it **Workflows** write access, a Run can no longer push a change to `.github/workflows`; make that change yourself.
