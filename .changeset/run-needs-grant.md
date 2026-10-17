---
"@deevy/core": patch
---

An Agent is given work only in the Projects it was granted. A comment mentioning it, or a record routed to it, in a Project it was not granted used to start a Run it could never see (it waited, pending, for good); now nothing starts. `issues.create`, and with it `deevy issues create --assign-agent`, refuses to assign such an Agent, saying to grant it the Project first. And taking a Project back from the Agent that is its Default Agent now leaves the Project with no default, with a `project.updated` Event saying so, instead of routing records to an Agent that cannot work them.
