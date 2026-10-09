# Every release upgrades in place

Until now a minor release could break what came before it, as long as its release notes said so, and one
did: 0.9 started its migration history afresh ([ADR-0024](./0024-an-issue-is-a-projection-of-a-record-in-a-socket.md)).
That was a promise made to a person, who reads the notes and decides when to upgrade. A deployment that
upgrades itself cannot read them.

Several things now run one release's code on the next release's schema. A Cloudflare gradual deployment
splits traffic between two Worker versions by percentage for as long as it takes, so the old version serves
requests against a database the new one has migrated — a D1 database is migrated before the deploy, and a
hosted Workspace's Durable Object migrates itself when it first wakes on the new version (ADR-0028,
docs/plans/hosted.md). A rollback is the previous version, on the same database. And on Docker, an
operator whose upgrade went wrong starts the previous image on the same volume. None of them has a way back
that runs a migration.

## The decision

**A release's migrations only add. What a release stops using is removed by a later release, never the
same one.** Expand, then contract:

- A release may add a table, a column that is nullable or has a default, and an index — a unique one only
  on a table the same migration creates. When it means to remove something, its code stops using it and
  leaves it in the schema: still written, if it is `NOT NULL` with no default, so that the previous
  release's reads find a value and this release's inserts do not fail.
- A later release removes it: drops the table or the column, renames, rebuilds a table, or tightens a
  constraint. That migration says so on a line of its own, with why and the earlier migration that shipped
  with the release that stopped using what this one removes — usually the one that added its replacement:

  ```sql
  -- deevy: contract issue.body has been unread since 0.12, expanded in 20261104090000_issue_text
  ```

So release N−1's code runs on release N's schema. The promise is one release. N−2 on N's schema is not
promised, because N may remove what N−1 stopped using and N−2 still used; going back further is restoring a
backup.

## How it is held

- **`vp run db#check:migrations`** refuses, in every migration written after this decision, `DROP TABLE`,
  `ALTER TABLE … DROP [COLUMN]`, `ALTER TABLE … RENAME`, drizzle-kit's table rebuild (`CREATE TABLE
__new_x`, copy, `DROP TABLE x`, `RENAME`), which is how it changes a column's type, nullability, default
  or foreign key on SQLite, and a unique index on a table the migration did not create. Each refusal names
  the file and the line and says what to do instead. An annotated migration passes when the migration it
  names exists and comes before it. The thirteen migrations written before this are named in
  `packages/db/scripts/expand-only.ts` and not judged.
- **`vp run server#test:previous`**, its own CI job, runs the claim. It builds the previous release's server
  from its tag — the newest `v*` tag behind the commit, or the one before when the commit is a release —
  with the tag's own lockfile, migrates a new database with this tree, and starts the previous release on
  it: it must start, sign a Human in through the OAuth stub, read over `/rpc`, and create an Agent. Then this
  tree starts again on what the previous release wrote. It also checks that every annotation names a
  migration the previous release carried, which is the half of the rule only git can see.
- **The Node migrator already tolerates a newer database.** drizzle 1.0.0-rc.4 decides what is pending by
  name and passes over a name it has no folder for, so the previous release starts on a database a newer
  one migrated. It did so silently; from this release it says so in its log, naming the migrations, because
  only one release back is promised. wrangler's D1 journal and drizzle's durable-sqlite migrator also
  decide by name, so an object waking on the older version finds nothing of its own left to apply.

## Why not the alternatives

**Down migrations.** drizzle-kit writes none, so each would be SQL written by hand, run once, in an
emergency, and never tested. And a gradual deployment runs both versions at once, which no down migration
can serve. Refused.

**Keep breaking in place, and say so in the release notes.** What OPERATIONS.md allowed. It works for a
person who reads before upgrading; it does not work for a platform that rolls a release out by percentage,
or for the operator who has to roll back at 2 a.m. Refused.

**Refuse removals outright.** The schema would only grow, and every column a feature stopped using would be
kept forever. The annotation lets a later release take it away.

**Check the release boundary in `check:migrations`.** Whether an expansion shipped is a question about tags,
and CI's checks run on a shallow clone with none. The static check says what it can without history —
the named migration exists and is earlier — and the smoke, which fetches the history anyway, says the rest.

**Run the previous release's Docker image instead of building its tag.** It needs a daemon, a pull, and a
volume shared with the host by a process that runs as another uid. Building the tag takes about twenty
seconds once the package store is warm, needs only the toolchain every checkout has, and runs the same on a
laptop as in CI.

## The cost, stated

- **Removing something takes two releases**, and if it is `NOT NULL` the release in between keeps writing a
  value nobody reads.
- **drizzle-kit's own answer to changing a column is refused.** Changing a type or a nullability becomes a
  new column, a backfill, the code moved to it, and the old one dropped a release later.
- **A unique index on a table that already has rows waits a release too**, after the code that keeps those
  rows unique has shipped.
- **The check reads SQL with patterns, not a parser.** It sees statements, not intent: an `UPDATE` or a
  `DELETE` that leaves rows the previous release cannot read is not refused, and a contraction whose
  annotation is wrong about what stopped using it passes the static check. The smoke catches what it
  exercises — a sign-in, a handful of reads, an Agent written — and no more.
- **A fifth CI job**: a second install and a second build, about half a minute when the store is warm.
- **One release, not two.** An operator who upgrades two releases at once and then rolls back both restores
  the backup taken before.
