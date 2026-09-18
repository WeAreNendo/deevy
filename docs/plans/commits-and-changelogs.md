# Conventional commits and changesets: what was built

The first after-v1 item that is not a feature, 2026-09-06. **Built** — this reads as the record of what
shipped, not as a proposal; ADR-0017 carries the decisions. Vocabulary is
[CONTEXT.md](../../CONTEXT.md); the milestone plans are [m1.md](./m1.md) through [m4.md](./m4.md). This is
done when a commit message says what kind of change it is in a form a machine reads, and a release writes its
own notes from what the pull requests declared, rather than from somebody re-reading the log.

Six slices, in dependency order. Each is one PR on `main`. Slices 1 and 2 are independent of each other;
3 needs 2, 4 needs 2, 5 needs 4, 6 needs all of them.

The thing that makes this repository an awkward fit for either tool, and which every decision below is
answering: **nothing here is published to npm.** All six workspace packages are `private: true` at version
`0.0.0`, and the release artifacts are two Docker images built from a `v0.x.y` tag. Changesets' native job is
bumping and publishing packages; here it has to be pointed at a product version instead. And merges are
squashed — `cbcc979 … (#12)` — so the message that lands on `main` is the **pull request title**, which means
a `commit-msg` hook is a courtesy and the pull-request title check is the one that decides what history looks
like.

## Decisions taken

- **Standard imperative subjects, not the prose the log is written in.** `feat(gates): add ruling authority
to Gate`, not `A Gate says who may rule on it, instead of implying it`. Every external tool that reads
  conventional commits — changelog generators, release tooling, GitHub's own summaries — expects lowercase
  imperative, and a house dialect buys nothing that is worth teaching each of them. The cost is real and
  should be said plainly: the voice of the last thirty commits does not survive this. It survives in the
  **body**, which stays prose and stays unconstrained, and in the changeset summaries, which is where the
  sentences that were doing the explaining now live. Nothing already committed is rewritten.
- **`config-conventional`'s defaults are wrong for this repository in exactly two rules, and both must be
  disabled rather than worked around.** `body-max-line-length` and `footer-max-line-length` are `100`; the
  bodies here are unwrapped paragraphs, one of them 700 characters on a single line. Left at the default the
  hook rejects the repository's own history the first time somebody writes a real commit message. Set both to
  `[0]`. `subject-case` needs no change and this is worth checking rather than assuming: it judges the casing
  of the whole subject string, so `add ruling authority to Gate` passes — a lowercase-initial subject with an
  embedded proper noun is neither sentence-case nor start-case — and the CONTEXT.md vocabulary (Gate, Human,
  Run, Issue, Member, Workspace, Agent) keeps its capitals where it belongs.
- **The versioned unit is deevy, and deevy is one version.** All six packages go in a changesets `fixed`
  group with `privatePackages: { "version": true, "tag": false }`. One number moves, and that number is the
  Docker image tag. Independent per-package versions would produce six of them for an artifact that has one,
  and the image tag would then be a choice somebody makes rather than a fact. If `@deevy/core` is ever
  published, the `fixed` group is one line to split.
- **One `CHANGELOG.md`, at the root.** Changesets writes a `CHANGELOG.md` per package and there is no option
  that stops it, so a fold step is part of `changeset version`: it takes the new top section out of each
  package's file, merges them into one root entry grouped by area, and deletes the per-package files, which
  are gitignored. That the per-package files only ever hold the current release is what makes the fold
  deterministic rather than a diff of two changelogs.
- **Every package starts at 0.4.0.** All six read `0.0.0`, which is not a version anybody released; M4 is
  done per PLAN.md and `release.yml` already accepted `v0.4.*`, so 0.4.0 is where the product actually stands.
- **The changelog starts clean.** No backfill of M0–M4: an entry that invents dates for releases that were
  never tagged is worse than a pointer to PLAN.md, the per-milestone plans, and the git log. Only `v0.3.0`
  was ever tagged.
- **A changeset is required where a package changed.** `changeset status --since=origin/main` exits `1` when
  package files changed and no changeset is present, which is the gate; a docs-only or CI-only pull request
  touches nothing inside a package and passes without one. The escape hatch for the remainder is
  `changeset add --empty`, whose whole purpose is this case, plus a `no-changelog` label for the pull request
  where an empty changeset is more ceremony than the change deserves.
- **Two ledgers, and neither is derived from the other.** A conventional commit classifies a _commit_; a
  changeset declares a _user-visible change and its size_. A `feat:` that nobody outside the repository can
  observe gets an empty changeset, and a one-line `fix:` can be the minor bump. Generating the changelog from
  commit types instead — the thing conventional commits is usually bought for — is deliberately not done
  here, because it would make the release notes a function of how the work was split into commits.
- **The release fires by `workflow_call`, not by the tag.** This is not a preference, it is a constraint: a
  tag pushed with `GITHUB_TOKEN` does not trigger another workflow, so wiring the Version PR merge to push
  `vX.Y.Z` and expecting `release.yml` to notice produces a release that silently never happens. The
  changesets job calls the publish workflow directly, the same way `release.yml` already calls `ci.yml`. The
  tag is still created and still pushed, because `docs/OPERATIONS.md` and the image tags refer to it and a
  human pushing a tag by hand stays a working escape hatch — its filter widens from `v0.1.*`–`v0.4.*`, which
  a `v0.5.0` would already fall outside of, to `v*`.
- **New dependencies take a catalog entry.** `@commitlint/cli`, `@commitlint/config-conventional`,
  `@changesets/cli` and `@changesets/changelog-github` go in `pnpm-workspace.yaml`'s catalog with `catalog:`
  refs, like everything else (CLAUDE.md, "Dependencies"). They are caret ranges, not exact pins: the exact
  pins there are for pre-release lines whose breakage is a runtime error, and these are neither.

## Slice 1 — a commit message says what kind of change it is

`@commitlint/cli` and `@commitlint/config-conventional` at the root, and `commitlint.config.js` beside
`vite.config.ts`:

- `extends: ["@commitlint/config-conventional"]`
- `rules`: `body-max-line-length: [0]`, `footer-max-line-length: [0]` — see the decision above; and
  **no `scope-enum`**. A scope stays optional and free-form: the changelog is grouped by the packages a
  changeset names, not by what a subject line claims, so a list here would be a second vocabulary to keep in
  step with the workspace for no reader's benefit.
- `header-max-length` stays at the inherited `100`. A squash adds ` (#123)` to the title, which is seven
  characters that the pull-request title check below must leave room for.

`.husky/commit-msg`, following the shape of the two hooks already there:

```sh
set -e
./node_modules/.bin/commitlint --edit "$1"
```

Deliberately **not** `. "$(dirname -- "$0")/vp.sh"` and not `pnpm exec`. `vp.sh` puts `vp` on PATH and
nothing else, and a hook does not inherit an interactive shell's PATH at all — the comment in `vp.sh` about
sourcing the env file hanging a commit with no output is the precedent. The `.bin` path needs neither pnpm
nor vp to be findable.

Tests: `tools/release/tests/commit-message.test.ts` runs the real commitlint through the same `--edit <file>`
path the hook takes, over a table of messages — the shape we want, a proper noun mid-subject, a sentence-case
subject, a 700-character body line, a squash-suffixed title, an over-long header. A rule set with no test is
a rule set that gets loosened by whoever it first annoys.

`tools/release` is a new workspace package, which the `tools/*` glob in `pnpm-workspace.yaml` already
anticipated. It joins the `core` test shard in `ci.yml` and the node-env lint override in the root
`vite.config.ts`.

Docs: `docs/DEVELOPMENT.md` gains a "What a commit message says" section, `CLAUDE.md` gains the rule near the
Commands section. `CLAUDE.md` matters more than usual here — Agents write most of the commits in this
repository, and a convention they cannot read is a convention that fails on every second commit.

## Slice 2 — the pull request title is the commit message

Because merges are squashed, this is the check that decides what `main`'s history looks like; slice 1 only
catches what a human sees before pushing.

A `title` job in a **new** `.github/workflows/pull-request.yml`, not in `ci.yml`. The trigger is why: this
needs `types: [… edited …]`, because a title fixed after a red check must re-run something, and adding
`edited` to `ci.yml`'s trigger would re-run the whole test matrix on every description edit. `labeled` and
`unlabeled` are there for slice 4's escape hatch.

It pipes the title into the same `commitlint` with the same config, so there is one rule set and not two that
drift — **through the environment, never `${{ }}` in the script**, because a title is attacker-controlled
text and interpolating it into a shell would run it.

## Slice 3 — a changeset declares what a release will say

`@changesets/cli` and `@changesets/changelog-github` at the root, and `.changeset/config.json`:

```json
{
  "$schema": "https://unpkg.com/@changesets/config/schema.json",
  "changelog": ["@changesets/changelog-github", { "repo": "WeAreNendo/deevy" }],
  "commit": false,
  "baseBranch": "main",
  "access": "restricted",
  "updateInternalDependencies": "patch",
  "privatePackages": { "version": true, "tag": false },
  "fixed": [
    [
      "@deevy/core",
      "@deevy/db",
      "@deevy/adapters",
      "@deevy/web",
      "@deevy/server",
      "@deevy/claude-agent"
    ]
  ],
  "ignore": []
}
```

`changelog-github` reads a `GITHUB_TOKEN` from the environment when `changeset version` runs, to turn a
changeset into a line that links its pull request and its author. Locally, without one, it fails rather than
degrading — so the `version` script must be the CI path, and a developer running `changeset version` by hand
needs a token or the plain `@changesets/changelog-git` fallback. Say so in the docs rather than letting the
first person discover it.

`tools/release/scripts/fold-changelog.ts` and a root `version` script, `changeset version && node
tools/release/scripts/fold-changelog.ts`. The fold:

1. Reads the new version from any one package (they are `fixed`, so they agree).
2. Takes each package's `CHANGELOG.md`, which after a `changeset version` on a gitignored file holds exactly
   this release's entries.
3. Drops the dependency bullets, which `updateInternalDependencies` generates for a `fixed` group and which
   say nothing a reader of a single-version product wants. **They come in three shapes**, each found by a
   trial run rather than by reasoning about them: `- Updated dependencies` heading an indented list, a bare
   `- @deevy/db@0.5.0`, and a `- @deevy/adapters@0.4.1` that itself heads an indented list. Only a bullet's
   first line can decide, because the third shape does not end where a whole-bullet pattern expects. A package with nothing at all gets `No
changes in this release.` and no `###` section.
4. Writes one `## X.Y.Z` section at the top of the root `CHANGELOG.md`, with `### Major/Minor/Patch` and the
   areas as a prefix. One changeset naming several packages writes the same bullet into each of their
   changelogs, so identical bullets are merged: `- **core, web** — Issues can be filtered by …`.
5. Syncs the root `package.json`, which changesets never sees because the root is not a workspace member, and
   which is where `changesets.yml` reads the tag from.
6. Leaves the per-package files alone. `changesets/action` reads them back to compose the Version PR, so
   deleting them fails the release; gitignoring them is what keeps them out of the commit.

`.gitignore` gains `packages/*/CHANGELOG.md`, `apps/*/CHANGELOG.md` and `tools/*/CHANGELOG.md`. The root `vite.config.ts` gains
`CHANGELOG.md` to `fmt.ignorePatterns`, for the reason already written next to `mcp-tools.json` there: the
generator owns its shape and the formatter must not have an opinion about it. `"format": false` in the changesets config settles the other half: changesets 3 auto-detects a formatter and
would otherwise reformat what it writes between `changeset add` and the commit.

Tests: `tools/release/tests/fold-changelog.test.ts`, against fixtures copied verbatim out of a real
`changeset version` run — one merged section, areas named once, bump levels in order, both dependency-bullet
shapes gone, the root synced, the per-package files left where the action can read them, a file that kept its history
folded from its newest section only, and a drifted `fixed` group refused.

## Slice 4 — a pull request without a changeset does not merge

A `changeset` job in the same `pull-request.yml`, doing a full-depth checkout to reach
`origin/main`, then `changeset status --since=origin/main`. It exits `1` when package files changed and no
changeset is present, and passes for a docs-only pull request, which is most of the escape hatch already.
`changedFilePatterns` in the changesets config takes `**/*.md`, `**/tests/**` and `**/*.test.ts` out of the
question as well, so the gate fires on shipping code only. The job is skipped when the pull request carries
the `no-changelog` label; the label needs creating on the repository, or it is a hatch nobody knows about.

`--since` reads the changesets **out of git rather than off disk**, found while testing this: run it before
committing and it reports none even with the file present. That makes it a CI-only check by nature, which is
where it runs. It also refuses to run while a `version` is in progress, so this job must not be part of
the release path — it is a pull-request check and nothing else.

Docs: `docs/DEVELOPMENT.md` gains "When a change needs a changeset", with `changeset add`, `changeset add
--empty`, and what a good summary reads like. This is the paragraph that decides whether the changelog is
worth reading in a year, so it is worth more than three lines: a changeset summary is written for somebody
upgrading deevy, not for somebody reviewing the diff.

## Slice 5 — a release writes its own notes

`.github/workflows/release.yml` is restructured. The `verify` job (`uses: ./.github/workflows/ci.yml`) and
both publish jobs keep their bodies; what changes is what starts them.

- The publish half becomes `on: workflow_call` with a `version` input, so it can be called rather than only
  triggered. The existing `on: push: tags:` stays as the manual escape hatch, widened to `v*` — today's
  `v0.1.*`–`v0.4.*` filter would not match the `v0.5.0` this work produces.
- A new `.github/workflows/changesets.yml`, on `push` to `main`, runs `changesets/action@v2` with
  `version-script: vp run version` and no `publish`. It opens and maintains the "Version Packages" pull request —
  whose own title and commit are conventional, because it is squash-merged like any other and slice 2 will
  read that title.
- **Releasing takes two conditions**, and getting it wrong cost three attempts. "No changesets waiting" is
  true of every ordinary commit on `main`, so the tag is the other half. And the changesets check is not
  redundant: the action runs the version command in place, so with changesets waiting the tree and HEAD are
  already bumped, and a tag step without that gate tags the Version PR's own commit and releases it while the
  pull request is open. Both facts are read from the commit and neither from the action's outputs — with no
  changesets and no publish script it returns without setting any, so `hasChangesets` is `""` rather than
  `"false"` and a guard on it silently never fires.
- **The Version PR is exempt from the changeset gate.** It is the one pull request that consumes changesets
  rather than adding one, so the gate is guaranteed to fail on it.
- **A prerelease never moves `latest`.** `type=raw,value=latest` was unconditional, which would have pointed
  the tag everybody pulls at a release candidate. That job then pushes `vX.Y.Z`, writes the GitHub Release from the new
  `CHANGELOG.md` section, and calls the publish workflow — calls it, because a tag pushed with
  `GITHUB_TOKEN` does not trigger a workflow.
- `release.yml` builds each architecture on a runner of its own — `ubuntu-latest` and `ubuntu-24.04-arm`,
  which are free for public repositories — pushing by digest and collecting the digests into the tags in a
  final job. It began as one job building both platforms together, which meant `linux/arm64` ran under QEMU
  while the Dockerfile installed and built the whole workspace inside the image; that cost about three times
  the native half and then hung outright on the 0.5.0-rc.0 release. Every docker build now carries a step
  timeout as well, because a hang that only trips the job timeout wastes twenty minutes saying nothing.
- `release.yml`'s image tags derive from the ref, which carries a version only on the
  tag-push route. On a call the ref is `main`, so the caller passes the version and `docker/metadata-action`
  gets both sources with `enable=` making them mutually exclusive.
- `permissions` on that workflow: `contents: write` (tag, release, and the Version PR's branch) and
  `pull-requests: write`. Repository settings must allow Actions to create pull requests, which is a checkbox
  and a five-minute failure the first time.

The image tags are unchanged: `docker/metadata-action` reads the tag ref, and a `v*` tag is what it gets
either way.

## Slice 6 — the history that already exists, and the decision written down

`CHANGELOG.md` ships with one `## 0.4.0` entry that backfills nothing and says so, pointing at PLAN.md, the
per-milestone plans, the ADRs and the git log. Only `v0.3.0` was ever tagged, so a backfill would be inventing
dates for releases that never happened.

[ADR-0017](../adr/0017-commits-are-conventional-and-release-notes-are-declared.md) records the two things that are hard to reverse: **the log's voice changed**,
which is a decision about the repository's own writing and not a tooling choice, and **the release notes are
declared, not derived**, which is why a changeset exists at all when conventional commits could have
generated a changelog on their own. The ADR is where the honest cost goes: two ledgers to keep, one of which
a contributor forgets and a CI job then blocks them for.

`README.md`'s docs paragraph gains `CHANGELOG.md`, `CLAUDE.md` gains the changeset rule beside the OpenAPI
snapshot rule it most resembles — a generated artefact CI fails on when it is missing — and
`docs/OPERATIONS.md`'s release section is rewritten around the Version PR instead of a hand-pushed tag.

## Release candidates

Added after the fact, once the release path had been walked end to end. `changeset pre enter rc` /
`changeset pre exit` around the normal flow; versions become `0.5.0-rc.N`; the `-` in the version marks the
GitHub Release as a prerelease and keeps `latest` where it is, and the fold drops the `X.Y.Z-*` sections the
final release supersedes.

Two things the probe found that the reasoning would have got wrong. `changeset version` in pre mode does not
delete a changeset, it **moves it into `.changeset/pre/`** so that leaving pre mode can re-read every change
into the final notes — which is why the workflow's `find -maxdepth 1` is load-bearing and commented as such;
counting those files would mean an rc never releases. And `pre.json` in changesets 3 is just `{mode, tag}`,
with none of the `initialVersions` or `changesets` bookkeeping older versions kept, so there is nothing there
worth reading.

The caveat is the changesets documentation's own: doing pre-releases from the default branch blocks every
other change until you exit. That is accepted here rather than solved with a release branch, and written
down in DEVELOPMENT.md and ADR-0017.

## What this does not do

- **No history rewrite.** `pre-squash-backup` suggests this repository has been through one already. Every
  commit before slice 1 keeps its prose subject and its missing type.
- **No backfilled changelog.** See slice 6.
- **No automatic version bump from commit types.** A `feat:` does not imply a minor release; the changeset
  says what the bump is. The two mechanisms would otherwise disagree and one of them would have to win
  silently.
- **No `semantic-release` and no `release-please`.** Either would replace changesets rather than join it, and
  both derive the changelog from commits, which the decision above rejects.
- **No snapshot releases.** They are npm's way to install a branch, and their own documentation says the
  version commit must never be merged — the opposite of a Version PR flow. An image tagged by commit is the
  equivalent here and needs no changesets.
- **~~Nothing published to npm.~~** True until the CLI (`docs/plans/cli.md`). `@deevy/cli` is published and
  everything else still is not — `access` stays `restricted` in the changesets configuration and the one
  package that publishes says `publishConfig.access: "public"` for itself. It did **not** come out of the
  `fixed` group: it is deevy, so it carries deevy's version, and `@deevy/cli@0.9.0` is the same number as the
  image. Publishing is its own job in `changesets.yml` rather than `changesets/action`'s `publish` input, for
  the same reason `create-github-releases` and `push-git-tags` are off there — this workflow owns the tag and
  the Release so they describe the folded changelog, and handing half the release back to the action would
  put two things in charge of when a version is out.

## Risks worth naming

- The `commit-msg` hook is skippable with `--no-verify`, and slice 2 is the reason that is acceptable: the
  squashed title is checked in CI where nobody can skip it.
- `changesets/action` needs the repository to allow Actions to create pull requests. Until that box is
  ticked, slice 5 fails on the release and not on any pull request, which is the worst place to find out.
- `changelog-github` fails without a token, including locally, which was confirmed rather than assumed while
  building this — the trial run had to swap the generator out. A developer who runs `vp run version` by hand
  hits this before anything else, so DEVELOPMENT.md says so.
- Two ledgers is genuinely more friction per pull request, and most of it lands on Agents. If the changeset
  gate turns into a label everybody applies, that is the signal the gate was wrong, not that the contributors
  were.
