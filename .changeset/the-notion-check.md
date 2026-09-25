---
"@deevy/sockets": patch
"@deevy/web": patch
---

Connecting Notion now refuses a personal access token. It acts as the person who made it, so deevy would have
written every comment as them and dropped their own comments, `/approve` included, as its echoes. Make an
internal connection and paste its token. The Connect Notion dialog and the Socket's page now use Notion's
current names — internal connections in the Developer portal, the installation access token, the Webhooks and
Content access tabs — and link the portal. A page Notion could only partly read now ends by saying what is
missing and where the whole page is. Notion's refusals read as words: "Notion would not take these
credentials: API token is invalid. (unauthorized, GET /users/me)".
