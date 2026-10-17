---
"@deevy/core": patch
"@deevy/web": patch
---

An Agent's own webhook is now sent only the Events of the Projects the Agent was granted. Until now it was sent every Event in the Workspace, including those of Projects the Agent cannot see and Workspace-level ones such as Members, invitations and Sockets; those no longer reach it, and a Project's Events stop the moment its grant is withdrawn. A runtime that only wakes on its own work, as the reference runtime does, needs no change: a Run handed to it, its Gates and their rulings all arrive as before, as long as the Agent is granted the Project. Generic subscriptions under Settings › Webhooks are unchanged. The Agent's page has a new Webhook section, for its Sponsor and admins, that sets the URL and the secret deevy signs deliveries with, generates a secret and shows it once, moves the deliveries without a new secret, and stops them; `deevy agents update --webhook-url --webhook-secret` still works.
