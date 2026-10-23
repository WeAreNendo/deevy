---
"@deevy/core": patch
"@deevy/sockets": patch
"@deevy/web": patch
---

A GitHub Socket now lets go of an installation that is uninstalled or suspended on GitHub. deevy ignored GitHub's word that the App was uninstalled from an account, and took a suspension for a new installation, so the Socket's page kept listing the account under **Where it is installed**, and binding a Project failed outright because GitHub would no longer give deevy a token for that account. Now an uninstall or a suspension takes the account off the Socket, and each is in the Event log as a new `socket.installation_removed` Event naming the accounts and why (`deleted` or `suspended`); an unsuspension puts the account back and appends `socket.installation_added`, as an installation does. A webhook subscription that takes every kind or `socket.*`, and names no Project, receives both; an Agent's own webhook does not, since they belong to no Project. Returning from GitHub's install page no longer lists an installation GitHub has suspended, and lists one installation once however its id was written in the address.

Binding a Project no longer fails because one installation refuses: when GitHub says an installation is gone or will not let the App in, the repositories of the others are still offered, and it fails only when none of them answer. A rate limit or a GitHub error still fails the list with GitHub's own answer, rather than leaving an installation's repositories out of it. And after the App is uninstalled from an account and installed there again, which gives the installation a new id, deevy finds the new one the first time GitHub says the old one is gone, where it used to fail every call for that account's repositories until the server restarted.
