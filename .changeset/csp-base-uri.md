---
"@deevy/core": patch
---

Reloading any page of deevy but the first one, or opening a link to it, no longer shows a blank page. The security policy every page carries refused the page's own `<base href>`, so the browser looked for the app's scripts under that page's path; it now allows a base on deevy's own origin. This affected every deployment since 0.11.0, at the root of a host or under a path, the hosted Worker and the Worker's static assets included.
