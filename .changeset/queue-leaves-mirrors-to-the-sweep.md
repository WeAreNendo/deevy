---
"@deevy/core": patch
---

On a Worker with a Queue bound, tracker comments and Slack message updates are sent again: the queue no longer retires them as undeliverable webhooks. Only webhook deliveries go on the queue now, and a queued message that names any other kind of delivery leaves it alone, so the next Cron pass sends it. Comments and message updates that were already given up on are not retried.
