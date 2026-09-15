# M3 acceptance: the agent loop on a free Cloudflare account

M3 is done when [PLAN.md](./PLAN.md)'s M2 scenario — a Claude Code loop picks up an assigned Issue, writes a
plan Document, hits the Plan Gate, and resumes after a Human approves — runs on a free Cloudflare account, and
then runs again on the Docker image built from the same commit. Two deployment shapes from one codebase is the
claim [ADR-0006](./adr/0006-runtime-agnostic-core-node-first.md) makes, and this walk is the only thing that
checks it.

**Status: walked. Parts 1 to 5 on 2026-09-04 against a free Cloudflare account, from the branch rather than
from a tag; part 6 on 2026-09-05 against `v0.3.0`, deevy's first tag. Both halves of ADR-0006's claim have now
been checked by a person rather than by CI.**

What ran. A Worker deployed to `deevy.matthias-etienne.workers.dev` with D1, GitHub sign-in and the Cron
Trigger; a Workspace bootstrapped by the admin's first sign-in; the `planner` Agent, its Project grant and its
key; `DEV-1` assigned to it, opening a `pending` Run before any agent woke up. Then a Claude Code loop outside
deevy, over `/mcp` with nothing but that key: it read the Issue and its intent Document, narrated as it went,
wrote the spec, stopped at the Spec Gate with a deevy URL, resumed on the Human's ruling, wrote the plan,
stopped at the Plan Gate, resumed again, and finished `completed` with a summary. Forty-two Events, thirteen
Activities, three Gate decisions, and the Issue in Build.

What the walk found, which nothing else could have. `runs.requestApproval` failed against a real client. Claude
Code declares no elicitation capability; the SDK refuses an `input_required` naming `elicitation/create` at
dispatch, after the tool callback has returned, so the Agent was told its call had failed over work that had
entirely succeeded and its own instructions then told it to fail the Run. Every test in the milestone declared
the capability, so the surface had only ever been exercised by a client that could take what it was offered.
Fixed and covered by a ninth test in `packages/core/tests/elicitation.test.ts`. Three documentation errors went
with it: a Workspace Event log view that does not exist, an Issues section that does not exist, and a
`wrangler d1 create` step that is not needed.

Part 6 found four more, none of them reachable by a test. The **first release published an image nobody can
pull**, and the workflow reported success while this document's opening command was broken for every reader.
The loop's instructions had **two dead ends** — a Document already written at a Gate nobody had been asked
about, and a Run that ended terminally on an Issue still assigned — each of which made it decide it was
finished while a Human waited; both were hit within an hour. It **believed a Run in `awaiting_input` goes
stale**, which it does not and cannot, because this repository's own instructions said so without naming the
statuses. And **an Agent's inbox never carried the ruling it waits for**, so ADR-0003's promise that an Agent
without a webhook polls its inbox was not true until `run_answered` existed. That last one was found by a
Human having to tell the agent by hand that its Gate had been decided.

Part 6, the container. `v0.3.0` was tagged and the Release workflow ran for the first time in deevy's life:
verify, the image build and its smoke, then eight minutes of multi-arch push. A container from that commit
answered `/healthz` in one second with its migrations applied, served the API as `401 application/json`, the
SPA as `<!doctype html>` and the MCP challenge naming its own origin — the same three answers the Worker gave —
and survived a stop, a remove and a restart on the same volume. Then the same loop, against
`http://localhost:3000`: assignment opened a `pending` Run before anything woke up, the Agent found it, wrote
`intent` v2 over an unfilled template, stopped at the Intent Gate, resumed on the ruling, wrote `spec` v2,
stopped again. The Event log reads `gate.approved`, `run.answered`, `document.created`, `gate.approved`.
Nothing about the runtime leaked into behaviour, which is the whole of what the claim says.

What did not run, and is not claimed. The **published image** was never pulled: a new GHCR package is private,
deevy stays pre-release, and `docker pull` answers `unauthorized`. Part 6 therefore ran against an image built
locally from the tagged commit — the same commit and the same Dockerfile, native arm64 rather than QEMU — so
the published artifact itself remains unverified. The walk also never reached a plan Document or a finished
Run on the container: the Plan Gate was approved while the plan was still its unfilled template, which deevy
allows, so the loop was stopped rather than followed to `runs_finish`. And `links_add` was never exercised on
either runtime — both loops ran from scratch repositories with no remote, so there was no pull request URL to
attach, and a summary naming two commits attached no evidence.

The Cron Trigger did run, and proving it took a functional test rather than a log. Three `wrangler tail`
windows over about ten minutes showed request traffic and no `scheduled` invocation at all, which reads exactly
like a dead schedule. It was not: giving the Agent `scheduleMinutes = 1` produced a Run with
`trigger = "schedule"` inside two minutes, so the Cron Trigger fired, `runDueWork` ran, and `sweepSchedules`
found the Agent whose interval had elapsed and opened its Run. `wrangler tail` was not showing scheduled
invocations; the schedule was never the problem. Anyone verifying a Cron Trigger on a deployment should give
the sweep something observable to do rather than watch the log for it.

This is a checklist, not documentation. How to deploy is [OPERATIONS.md](./OPERATIONS.md); what the loop does
and why is [agent-loop.md](./agent-loop.md). Each step below says the command and what it should answer, so a
step that answers something else is where to stop.

## What you need

- A free Cloudflare account, and `wrangler login` done. No paid feature is used: no Queues, no Durable
  Objects, no Hyperdrive.
- Two GitHub OAuth Apps — one whose callback is the `workers.dev` origin, one whose callback is
  `http://localhost:3000`. An App holds a single callback URL, so the Worker and the container cannot share
  one.
- A GitHub account whose primary email you will use as `DEEVY_ADMIN_EMAIL`. Its first sign-in creates the
  Workspace.
- Claude Code, and a scratch repository to run the loop from. It never needs to be deevy's own.
- Docker, for part 6.

## Part 1 — the Worker, from the tag

1. **Settle the committed configuration, then tag.** One deployment fact lives in `apps/web/wrangler.jsonc`
   rather than in a secret: the `vars` block naming `DEEVY_ADMIN_EMAIL` and `DEEVY_WORKSPACE_NAME`. The
   database needs nothing committed at all — the configuration names it and the first deploy provisions it —
   and everything that depends on the origin is a secret, so land the `vars` block on `main` first and the tag
   needs no editing afterwards:

   ```bash
   git tag v0.3.0 && git push origin v0.3.0
   ```

   The Release workflow runs CI and then publishes `ghcr.io/WeAreNendo/deevy:v0.3.0` and `:latest` for both
   architectures. Part 6 uses that image; the Worker is deployed by hand from the same tag, because nothing in
   CI holds a Cloudflare credential.

2. **Check out the tag and deploy it**, unmodified. Follow
   [Deploying to a free account](./OPERATIONS.md#deploying-to-a-free-account) end to end: the first deploy,
   which provisions the database and names the origin, then the migrations, the GitHub OAuth App, the secrets,
   and the deploy that makes them live.

   Expected at the end of it: `git status` is clean on the tag, `/healthz` answers `{"ok":true}` on the
   `workers.dev` origin, and `wrangler tail` shows a `scheduled` invocation once a minute.

3. **The API is the API and the SPA is the SPA.** The one thing that fails silently in production:

   ```bash
   curl -s -o /dev/null -w '%{http_code} %{content_type}\n' https://deevy.<subdomain>.workers.dev/api/issues/DEV-1
   curl -s https://deevy.<subdomain>.workers.dev/issues/DEV-1 | head -1
   ```

   The first is `401 application/json` — the API refusing an anonymous caller. The second is `<!doctype html>`
   — the SPA. A `<!doctype html>` from the first means `assets.run_worker_first` lost a rule.

4. **The MCP challenge names the deployed origin.**

   ```bash
   curl -sD - -o /dev/null -X POST https://deevy.<subdomain>.workers.dev/mcp \
     -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
     -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | grep -i www-authenticate
   ```

   Expected: a 401 whose `WWW-Authenticate` carries
   `resource_metadata="https://deevy.<subdomain>.workers.dev/.well-known/oauth-protected-resource/mcp"`. If it
   names any other host, `BETTER_AUTH_URL` is not the origin the browser uses and sign-in will mint tokens
   nobody can use.

## Part 2 — the Workspace, the Agent, and the work

5. **Sign in** at `https://deevy.<subdomain>.workers.dev` with the admin GitHub account. Expected: you land in
   the Workspace as its admin, and Settings, Members lists exactly one Member — you, `admin`, `human`.

6. **Create the Project.** Projects, New: name `deevy`, key `DEV`. Expected: the default Workflow — Intent,
   Spec, Plan, Build, Review, Done, with Gates on leaving Intent, Spec, Plan and Review.

7. **Create the Agent.** Settings, Agents, New: name `Planner`, handle `planner`. Expected: a Member with kind
   `agent` whose Sponsor is you.

8. **Grant it the Project**, on the Agent's page. Expected: `deevy` listed under its Projects. Skipping this is
   the most common way to make the loop fail, and it fails as "No such Project" rather than as a refusal.

9. **Issue an API key**, on the same page. The plaintext is shown once. Expected: a key you can put in the
   loop's environment as `DEEVY_AGENT_KEY`; the page afterwards shows the key's name and never the key.

10. **Create the Issue and give it to the Agent.** There is no top-level Issues section: an Issue is made on
    its Project's own page, `/projects/DEV`, where the Issue list opens with a New Issue field and an Add
    Issue button. Title it `Ship M3`. Then open `DEV-1`, set its Assignee to `planner`, and approve the Intent
    and Spec Gates so it sits in Plan.

    Expected: the Issue is `DEV-1`, it is in the Plan State, and its Runs list already shows one Run,
    `trigger: assignment`, `status: pending`. The Run exists before the loop wakes up — that is the trigger,
    and the loop's job is to find it, not to start it.

## Part 3 — the loop, outside deevy

11. **Point Claude Code at the deployed instance.** In the scratch repository:

    ```bash
    export DEEVY_AGENT_KEY=<the key from step 9>
    claude mcp add --transport http deevy https://deevy.<subdomain>.workers.dev/mcp \
      --header "Authorization: Bearer $DEEVY_AGENT_KEY"
    ```

    Expected: `claude mcp list` shows `deevy` connected. A 401 here is the key, the header, or an Agent with no
    grants.

12. **Give it the instructions.** Copy the `CLAUDE.md` snippet from [agent-loop.md](./agent-loop.md) into the
    scratch repository, unchanged.

13. **Run it**, with the same allowlist [agent-loop.md](./agent-loop.md) gives, built up so no line has to
    wrap:

    ```bash
    tools=mcp__deevy__inbox_list,mcp__deevy__runs_list,mcp__deevy__issues_get
    tools=$tools,mcp__deevy__documents_get,mcp__deevy__documents_write
    tools=$tools,mcp__deevy__runs_post_activity,mcp__deevy__runs_request_approval
    tools=$tools,mcp__deevy__links_add,mcp__deevy__runs_finish

    claude -p "Work your next assigned Issue." \
      --strict-mcp-config --mcp-config .mcp.json --allowedTools "$tools"
    ```

    Expected, in deevy, while it runs: the Run moves from `pending` to `active` on its first Activity; the
    Activity feed fills with thoughts and actions; a `plan` Document appears on `DEV-1` at version 1; and the
    Run ends at `awaiting_input` with an elicitation carrying a URL of the form
    `https://deevy.<subdomain>.workers.dev/issues/DEV-1?gate=<stateId>`.

    Expected in the terminal: the loop stops and says it is waiting for a Human. It must not have tried to
    approve the Gate; `gates_approve` is not in its tool list and would be refused if it were (ADR-0011).

14. **Watch the board move on its own.** Keep the Issue page open in a second browser during step 13 and do
    not reload it. Expected: the Activities and the Document appear as they are written. On Workers each live
    stream ends after `DEEVY_STREAM_SECONDS` and the browser resumes from the cursor it signed off with, so a
    walk longer than a minute is also the test that the seam is invisible (ADR-0012).

## Part 4 — the Human at the Gate

15. **Open the link the Agent produced**, from the inbox row or from the elicitation. Expected: the Issue page
    with that Gate focused, the plan Document beside it, and the Activity feed that explains how it got there.

16. **Approve, with a note.** Expected: the Gate records you as the deciding Human, the Issue moves to Build,
    and the Run goes back to `active`.

17. **The loop carries on.** It calls `runs_request_approval` again and is told `approved` with your note.
    Expected: it attaches a pull request Link to the Run and finishes with a summary; the Run is `completed`.

## Part 5 — what the record has to say

18. **The Issue.** `DEV-1` is in Build, carries the `plan` Document and the pull request Link, and the Gate
    decisions carry their notes.

19. **The inbox.** Your inbox has the `run_finished` Notification, and had the `gate_awaiting` one before you
    decided.

20. **The Event log**, filtered to Runs, reads:

    ```
    run.started  run.activity …  run.awaiting_input  run.answered  run.activity  run.completed
    ```

    with the Agent as the actor on every row except `run.started` and `run.answered`, which carry you: the
    Agent narrated its own work, and the two Events it could not cause itself name the Human who did. That is
    the accountability PLAN.md claims, read straight off the log.

21. **Nothing was reloaded to see any of it.** If the board only caught up on a refresh, live updates did not
    survive the deployment and step 14 is where to look.

## Part 6 — the same commit as a container

22. **Run the published image**, with the second OAuth App:

    ```bash
    docker run -d --name deevy -p 3000:3000 -v deevy-acceptance:/data \
      -e BETTER_AUTH_URL=http://localhost:3000 \
      -e BETTER_AUTH_SECRET="$(openssl rand -base64 32)" \
      -e GITHUB_CLIENT_ID=... -e GITHUB_CLIENT_SECRET=... \
      -e DEEVY_ADMIN_EMAIL=you@example.com \
      ghcr.io/WeAreNendo/deevy:v0.3.0
    ```

    Expected: `curl http://localhost:3000/healthz` answers `{"ok":true}` within a few seconds, the migrations
    having run at startup.

23. **Walk steps 5 through 21 again**, against `http://localhost:3000`, with a second Agent key. Expected: the
    same Issue key, the same Documents, the same Event log, the same accountability. Where the two differ, the
    difference is a runtime leaking into behaviour and it is a bug in the milestone rather than in the walk.

24. **Stop and start on the same volume.** Expected: everything is still there and `/healthz` answers, which
    is the volume's half of the claim.

## Recording the result

When it has been run, replace the status line at the top with the date, the tag, and anything the walk found.
A step that failed and was worked around is a finding, not a footnote: M2's own release slice found that an
Agent could not discover its own work, and that hole was only visible from inside the scenario.
