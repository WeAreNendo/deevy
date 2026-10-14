---
"@deevy/core": patch
"@deevy/web": patch
---

Opening or reloading a Gate, a Run, a record, a Project, a Settings page or an invitation link no longer shows a blank page, and neither does a deployment's own address under a path when it has no trailing slash (`/acme`). Since 0.11.0 the security policy every page carries refused the page's own `<base href>`, so the browser looked for deevy's scripts under that page's path. It now allows a base on deevy's own origin. Every deployment was affected: the image, the Worker, and hosted Workspaces.
