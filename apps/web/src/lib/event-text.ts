/**
 * What an Event says (docs/plans/ui-redesign-2.md slice D), shared by the Issue's
 * Activity, the Event log and the Inbox: the sentence with the actor as its
 * subject and the object named — which Gate, which Labels, which State — the
 * words someone wrote as `detail`, and the tone the row takes. New Events carry
 * names beside ids (the core writes them); older ones are resolved through the
 * maps the caller has, and fall back to a plain sentence rather than an id.
 */
export type EventTone = "human" | "agent" | "gate" | "muted" | "destructive";

/**
 * The colour a tone takes on screen, as text: the one map the Inbox glyph,
 * the Event log's kind and any other row that speaks in a tone read from.
 */
export const toneClass: Record<EventTone, string> = {
  human: "text-human",
  agent: "text-agent",
  gate: "text-gate-foreground dark:text-gate",
  muted: "text-muted-foreground",
  destructive: "text-destructive",
};

/** The same tones as a timeline dot: an edge in the hue, a tint inside. */
/**
 * A bullet, not a bauble: `size-2.5` against the kit's `size-4`, which at
 * deevy's density is 10.5px rather than 16.8 — the marks run down the edge of
 * the Activity as punctuation, and at the larger size they were the first
 * thing on every line.
 *
 * The indicator is `absolute` and pinned to the top of its row, so it has to be
 * pushed onto the centre of the line beside it: half the difference between the
 * 20px line box and the dot, 4.75px. A translate rather than `top`, which is
 * what this used to say and never did: the Timeline sets
 * `group-data-[orientation=vertical]/timeline:top-0` on the indicator itself,
 * and a variant beats a plain `top-*` however late it is in the class list.
 * Change the size and measure the pair again in the browser.
 */
const alignedToTheLine = "size-2.5 translate-y-[4.75px]";

export const toneDotClass: Record<EventTone, string> = {
  human: `${alignedToTheLine} border-human bg-human/15`,
  agent: `${alignedToTheLine} border-agent bg-agent/15`,
  gate: `${alignedToTheLine} border-gate bg-gate/25`,
  muted: `${alignedToTheLine} border-border bg-muted`,
  destructive: `${alignedToTheLine} border-destructive bg-destructive/15`,
};

export interface EventText {
  text: string;
  detail: string | null;
  tone: EventTone;
  /** A Run's plain step, or a Document write: the kind an Agent's day is made of, foldable. */
  routine: boolean;
}

export interface EventLike {
  kind: string;
  payload: unknown;
  actorKind?: "human" | "agent" | null;
}

export interface EventContext {
  memberName?: (id: string) => string | null | undefined;
  labelName?: (id: string) => string | null | undefined;
}

const str = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;
const list = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
const join = (items: string[]) => items.join(", ");

export function describeEvent(event: EventLike, context: EventContext = {}): EventText | null {
  const p =
    event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
      ? (event.payload as Record<string, unknown>)
      : {};
  const agentTone: EventTone = event.actorKind === "agent" ? "agent" : "muted";
  // Something said in a voice: an Agent's rose, a Human's blue.
  const byActor: EventTone = event.actorKind === "agent" ? "agent" : "human";
  const say = (
    text: string,
    detail: string | null = null,
    tone: EventTone = "muted",
    routine = false,
  ) => ({
    text,
    detail,
    tone,
    routine,
  });
  const member = (id: unknown, name: unknown) =>
    str(name) ?? (typeof id === "string" ? (context.memberName?.(id) ?? null) : null);
  switch (event.kind) {
    case "issue.created":
      return say(str(p.key) ? `opened ${str(p.key) ?? ""}` : "opened this record");
    case "issue.synced": {
      // What the tracker said differently, which is the whole of what a reader
      // wants: "it changed" is a line nobody can do anything with.
      const changed = list(p.changed);
      return say(
        changed.length > 0
          ? `synced it from the tracker: ${changed.join(", ")}`
          : "synced it from the tracker",
        null,
        "muted",
        true,
      );
    }
    case "issue.closed":
      return say("closed it in the tracker", null, "muted");
    case "issue.reopened":
      return say("reopened it in the tracker", null, "muted");
    case "issue.assigned": {
      const to = member(p.to, p.toName);
      const from = member(p.from, p.fromName);
      // Routed, not assigned: a label or a Project's default named the Agent,
      // and saying "assigned" would credit a Human who did nothing (ADR-0024).
      const verb = p.byRouting ? "routed" : "assigned";
      if (!to) return say(`unassigned it${from ? ` (was ${from})` : ""}`);
      return say(`${verb} it to ${to}${from ? ` (was ${from})` : ""}`);
    }
    case "delegation.refused": {
      const allowed = typeof p.allowed === "number" ? p.allowed : null;
      const which =
        p.limit === "depth"
          ? "sub-issues may not go deeper here"
          : p.limit === "open"
            ? "this tree already has as many open sub-issues as it may"
            : "this Issue already has as many sub-issues as it may";
      return say(
        `could not open another sub-issue: ${which}${allowed === null ? "" : ` (${String(allowed)})`}`,
        null,
        agentTone,
      );
    }
    case "issue.children_closed": {
      const children = typeof p.children === "number" ? p.children : null;
      return say(
        children === null
          ? "every sub-issue of this is finished"
          : `${children === 1 ? "the sub-issue" : `all ${String(children)} sub-issues`} of this ${children === 1 ? "is" : "are"} finished`,
        null,
        "muted",
      );
    }
    case "issue.link_added": {
      const url = str(p.url);
      let host: string | null = null;
      try {
        host = url ? new URL(url).host : null;
      } catch {
        host = null;
      }
      return say(
        `added a ${str(p.kind) ?? "link"}${host ? ` on ${host}` : ""}`,
        url,
        agentTone,
        true,
      );
    }
    case "issue.link_removed":
      return say("removed a link", str(p.url));
    case "run.started": {
      const trigger = str(p.trigger);
      const by =
        trigger === "assignment"
          ? ", by assignment"
          : trigger === "state_rule"
            ? ", by the State's rule"
            : trigger === "manual"
              ? ""
              : trigger
                ? `, by ${trigger}`
                : "";
      return say(`started a Run${by}`, null, "agent", true);
    }
    case "run.activity":
      return null; // The Run card shows its Activities; the stream would only repeat them.
    case "run.awaiting_input":
      return p.gateStateId
        ? say(
            str(p.state) ? `is waiting at the ${str(p.state) ?? ""} Gate` : "is waiting at a Gate",
            null,
            "gate",
          )
        : say("is waiting on a Human", str(p.question), "agent");
    case "run.answered":
      return say("answered the Run", null, "human");
    case "run.completed":
      return say("finished the Run", str(p.summary), "agent", true);
    case "run.failed":
      return say("failed the Run", str(p.summary), "destructive");
    case "run.went_stale":
      return say("went quiet", null, "muted");
    case "comment.created":
      return say("commented", null, byActor);
    case "member.joined":
      return say(`joined as ${str(p.role) ?? "a member"}`, null, "human");
    case "member.role_changed":
      return say(`changed the role from ${str(p.from) ?? "?"} to ${str(p.to) ?? "?"}`);
    case "member.suspended":
      return say("suspended a Member", null, "destructive");
    case "member.reinstated":
      return say("reinstated a Member");
    case "agent.created":
      return say(
        `created the Agent ${str(p.name) ?? ""}${str(p.handle) ? ` (@${str(p.handle) ?? ""})` : ""}`,
      );
    case "agent.updated":
      return say(`changed ${join(list(p.changed)) || "the Agent"}`);
    case "agent.sponsor_changed":
      return say(`changed the Sponsor to ${member(p.to, p.toName) ?? "another Human"}`);
    case "agent.key_issued":
      return say(`issued the API key ${str(p.name) ?? ""}`);
    case "agent.key_revoked":
      return say("revoked an API key", null, "destructive");
    case "agent.project_granted":
      return say(`granted ${str(p.projectSlug) ?? "a Project"}`);
    case "agent.project_revoked":
      return say("revoked a Project", null, "destructive");
    case "project.created":
      return say(`created the Project ${str(p.key) ?? ""} ${str(p.name) ?? ""}`.trim());
    case "project.updated": {
      const changed = Object.keys(p);
      return say(`changed the Project's ${join(changed) || "settings"}`);
    }
    case "project.archived":
      return say(`archived ${str(p.slug) ?? "the Project"}`, null, "destructive");
    case "run.checkout_issued":
      // What it cloned and where it will push. Never the credential: the log
      // says one was issued and nothing more (ADR-0014).
      return say(
        `took a checkout of ${str(p.cloneUrl) ?? "the repository"} on ${str(p.headBranch) ?? "a branch"}`,
        null,
        agentTone,
        true,
      );
    case "run.pull_request_opened": {
      const number = typeof p.number === "number" ? `#${String(p.number)}` : "";
      return say(`opened pull request ${number}`.trim(), str(p.url), agentTone);
    }
    case "gate.requested": {
      const checkpoint = str(p.checkpoint) ?? "a Checkpoint";
      const visit = typeof p.visit === "number" ? p.visit : 1;
      return say(
        visit > 1
          ? `asked again to pass ${checkpoint}, visit ${String(visit)}`
          : `asked to pass ${checkpoint}`,
        null,
        agentTone,
      );
    }
    case "gate.superseded":
      return say(
        `changed what it was asking at ${str(p.checkpoint) ?? "a Checkpoint"}`,
        null,
        "muted",
        true,
      );
    case "gate.approval": {
      // The arithmetic four-eyes is about, said out loud: one of two is not a
      // decision, and a reader should never have to count the rows themselves.
      const of = typeof p.required === "number" ? p.required : null;
      const so = typeof p.approvals === "number" ? p.approvals : null;
      return say(
        so !== null && of !== null
          ? `approved ${str(p.checkpoint) ?? "it"}, ${String(so)} of ${String(of)}`
          : `approved ${str(p.checkpoint) ?? "it"}`,
        str(p.note),
        byActor,
      );
    }
    case "gate.approved":
      return say(`let it past ${str(p.checkpoint) ?? "the Checkpoint"}`, str(p.note), byActor);
    case "gate.rejected":
      return say(
        `sent it back from ${str(p.checkpoint) ?? "the Checkpoint"}`,
        str(p.note),
        "destructive",
      );
    case "gate.ruling_refused": {
      // Somebody ruled from the tracker and it did not count. Said here as it
      // was said there, so the two records agree about what happened (ADR-0025).
      const who = str(p.externalActor);
      const why =
        str(p.reason) === "unknown_identity"
          ? "an account nobody here has linked"
          : str(p.reason) === "nothing_waiting"
            ? "nothing was waiting on a ruling"
            : (str(p.message) ?? "the Checkpoint would not take it");
      const where = str(p.via) === "slack" ? "in Slack" : "from the tracker";
      return say(
        `${who ? `@${who}` : "somebody"} ruled ${where} and it counted for nothing: ${why}`,
        null,
        "muted",
      );
    }
    case "identity.linked": {
      const login = str(p.login);
      const how =
        str(p.verifiedBy) === "email"
          ? "by the address it reports"
          : str(p.verifiedBy) === "sign_in"
            ? "from the account they sign in with"
            : null;
      return say(
        `linked ${login ? `@${login}` : "an account"} on ${str(p.instance) ?? "a tool"}${how ? `, ${how}` : ""}`,
        null,
        "muted",
        true,
      );
    }
    case "identity.revoked": {
      const login = str(p.login);
      return say(
        `unlinked ${login ? `@${login}` : "an account"} on ${str(p.instance) ?? "a tool"}`,
        null,
        "muted",
        true,
      );
    }
    case "socket.connected": {
      const provider = str(p.provider);
      const named = str(p.name) ?? "a Socket";
      const login = str(p.login);
      return say(
        `connected ${named}${provider ? `, a ${provider} Socket` : ""}${login ? `, as @${login}` : ""}`,
      );
    }
    case "socket.updated":
      return say(`changed ${str(p.name) ?? "a Socket"}`);
    case "socket.mirror_exhausted":
      // deevy could not say back in the tracker what happened here, and has
      // stopped trying: the two records have drifted, and somebody should know.
      return say(
        `could not say this in ${str(p.name) ?? "the tool"}, and has stopped trying`,
        null,
        "destructive",
      );
    case "socket.installation_added": {
      // One App serves every place somebody installs it, so this is the tool
      // telling deevy where it now is rather than anybody in deevy acting.
      const accounts = list(p.accounts);
      const named = str(p.name) ?? "a Socket";
      return say(
        accounts.length > 0
          ? `${named} was installed on ${join(accounts)}`
          : `${named} was installed somewhere new`,
        null,
        "muted",
        true,
      );
    }
    case "socket.removed":
      return say(`disconnected ${str(p.name) ?? "a Socket"}`, null, "destructive");
    case "allowlist.rule_added":
      return say(`allowed ${str(p.kind) ?? ""} ${str(p.value) ?? ""}`.trim());
    case "allowlist.rule_removed":
      return say(
        `stopped allowing ${str(p.kind) ?? ""} ${str(p.value) ?? ""}`.trim(),
        null,
        "destructive",
      );
    // Who may join, one address at a time: the payload carries the address and
    // the role, so the log reads without a lookup (docs/plans/sign-in.md).
    case "invitation.created":
      return say(`invited ${str(p.email) ?? "somebody"} as ${str(p.role) ?? "a member"}`);
    case "invitation.revoked":
      return say(`revoked the invitation for ${str(p.email) ?? "somebody"}`, null, "destructive");
    case "invitation.accepted":
      return say(`accepted the invitation for ${str(p.email) ?? "their address"}`, null, "human");
    case "channel.created":
      return say(`connected the Channel ${str(p.name) ?? ""}`);
    case "channel.updated":
      return say(`changed the Channel ${str(p.name) ?? ""}`);
    case "channel.deleted":
      return say(`removed the Channel ${str(p.name) ?? ""}`, null, "destructive");
    case "routing.updated":
      return say(
        typeof p.rules === "number"
          ? `set ${String(p.rules)} routing rules`
          : "changed the routing rules",
      );
    case "webhook.subscribed":
      return say(`subscribed a webhook on ${str(p.host) ?? "a host"}`);
    case "webhook.removed":
      return say(`removed a webhook on ${str(p.host) ?? "a host"}`, null, "destructive");
    case "webhook.exhausted":
      return say("gave up on a webhook delivery", str(p.error), "destructive");
    case "workspace.created":
      return say(`created the Workspace ${str(p.name) ?? ""}`);
    case "workspace.updated": {
      // A rename and a changed limit are the same Event; only a rename carries
      // a new name (docs/plans/sub-issue-delegation.md).
      const renamed = str(p.to);
      if (renamed) return say(`renamed the Workspace to ${renamed}`);
      const limits = [
        typeof p.maxChildrenPerIssue === "number"
          ? `${String(p.maxChildrenPerIssue)} sub-issues each`
          : null,
        typeof p.maxDelegationDepth === "number"
          ? `${String(p.maxDelegationDepth)} levels deep`
          : null,
        typeof p.maxOpenDescendants === "number"
          ? `${String(p.maxOpenDescendants)} open in one tree`
          : null,
      ].filter((one): one is string => one !== null);
      return limits.length > 0
        ? say(`set how far an Agent may split work up: ${join(limits)}`)
        : say("changed the Workspace");
    }
    default:
      return say(event.kind);
  }
}
