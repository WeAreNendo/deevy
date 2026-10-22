---
"@deevy/core": patch
---

A Project created with a Default Agent (`projects.create` with `defaultAgentMemberId`, which the CLI and the API can send) now grants that Agent the Project, as choosing one on an existing Project always has. Before, the Agent was the default of a Project it could not see, so every record routed to it waited and no Run started. `projects.create` also refuses a default that is not one of the Workspace's Agents, as `projects.update` does. A Project created this way before the upgrade keeps its default without the grant: grant it the Project on the Agent's page, or set the Project's **Default Agent** to **Nobody** and then back to the Agent (choosing the Agent it already has changes nothing, so grants nothing).
