-- At most one open Run per (Issue, Agent) becomes the database's rule rather
-- than a thing every caller remembers to check first. An instance that ran the
-- race before this could already hold duplicates, and a unique index that
-- refuses to build leaves a deployment unable to start — so the older ones are
-- closed first. The first-inserted is the attempt that has the work in it.
UPDATE `run`
   SET `status` = 'failed',
       `finished_at` = coalesce(`finished_at`, cast(unixepoch('subsecond') * 1000 as integer)),
       `summary` = coalesce(`summary`, 'Closed when one open Run per Issue and Agent became a rule the database keeps: this was a second attempt at the same work.')
 WHERE `status` in ('pending', 'active', 'awaiting_input', 'stale')
   AND `rowid` NOT IN (
     SELECT min(`rowid`) FROM `run`
      WHERE `status` in ('pending', 'active', 'awaiting_input', 'stale')
      GROUP BY `issue_id`, `agent_member_id`
   );--> statement-breakpoint
CREATE UNIQUE INDEX `run_open_per_issue_agent_uidx` ON `run` (`issue_id`,`agent_member_id`) WHERE "run"."status" in ('pending', 'active', 'awaiting_input', 'stale');
