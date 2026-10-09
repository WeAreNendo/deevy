---
"@deevy/core": minor
"@deevy/email": minor
"@deevy/server": minor
"@deevy/web": minor
---

**deevy can now email a Human when a Gate or a Run waits on them**, through [Resend](https://resend.com) for now, with more senders to come. Set `DEEVY_EMAIL_SENDER=resend`, `DEEVY_EMAIL_FROM` (an address on a domain Resend has verified, such as `deevy <deevy@yourcompany.com>`) and `RESEND_API_KEY`, on the Docker image or as Worker secrets. A sender set up halfway stops the Docker image at startup, naming what is missing; a Worker stays up and says so under Settings › Email.

A Human is emailed at the address their sign-in provider verified, never at one it did not: a Linear or Atlassian sign-in gets no email. Until they can choose under Settings › Notifications, they get an email for a Gate awaiting them and for a Run awaiting their answer, and nothing else. A Gate's email names the Agent, the Checkpoint and the record, quotes the start of the Proposal, and links to the Gate in deevy, where they rule as before.

An email the sender refuses for good (a bad key, an unverified domain) is given up on at once and recorded in the Event log as `email.exhausted`, in the sender's own words. With no sender configured, nothing is queued up for later.
