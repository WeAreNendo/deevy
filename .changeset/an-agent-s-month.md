---
"@deevy/core": minor
"@deevy/web": minor
---

**An Agent's page now tells its Sponsor what the Agent costs.** A new **Usage** section shows this month and last:

- how many Runs there were, and how many reported nothing;
- the cost as the clients' estimate, with the tokens it came to and how many no cost covers;
- the working time, with the waiting time in the tooltip;
- per finished Run, the average cost and working time. The average cost is taken over the finished Runs that reported one, so an unpriced Run never quietly lowers it.

Only the Agent's Sponsor and admins see the section. The same numbers come from the new `agents.usage` operation (`GET /agents/{memberId}/usage`, up to twelve calendar months in UTC, counting each Run in the month it was created).
