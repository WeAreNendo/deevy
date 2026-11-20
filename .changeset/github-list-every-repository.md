---
"@deevy/sockets": patch
---

Binding a Project to a GitHub repository now offers every repository the App is installed on. deevy read only the first page of an installation's repositories, so on an organization where the App was installed on more than a hundred, the rest were never offered under **Container**. It now reads every page, up to ten thousand repositories for each installation.
