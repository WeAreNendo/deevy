/**
 * deevy's Linear module, checked against the schema Linear publishes.
 *
 * The provider tests hold the module to recorded payloads with the network
 * replaced, which proves what deevy does with what it assumed Linear says —
 * and nothing about whether Linear still says it. This asks the schema instead
 * (`packages/sdk/src/schema.graphql` in linear/linear, the one Linear's own SDK
 * is generated from), with no Linear account:
 *
 * - every GraphQL document the module sends, driven through the module's real
 *   code with a recording `fetch`, is validated against the schema, and so is
 *   every variable it sends with it — a field, an argument, an input key or an
 *   enum value Linear does not have is a failure, and a deprecated one is said;
 * - every field deevy reads from a webhook delivery (`payloads.ts`) is looked up
 *   in the payload types the same schema describes.
 *
 * `vp run sockets#check:linear`. It reaches GitHub for the schema, so it is a
 * check to run when Linear changes, not a test (docs/DEVELOPMENT.md).
 */
import {
  buildSchema,
  isInputType,
  isNonNullType,
  NoDeprecatedCustomRule,
  parse,
  typeFromAST,
  validate,
  validateInputValue,
  type GraphQLSchema,
  type OperationDefinitionNode,
} from "graphql";
import { createLinearSocket, resetLinearTokens } from "../src/linear/index.ts";

const SCHEMA_URL =
  "https://raw.githubusercontent.com/linear/linear/master/packages/sdk/src/schema.graphql";

/** What each operation answers here: enough for the module to carry on to its next request. */
const node = {
  id: "i1",
  identifier: "ENG-1",
  url: "https://linear.app/acme/issue/ENG-1/x",
  title: "A record",
  description: "Its words",
  updatedAt: new Date().toISOString(),
  parent: null,
  delegate: null,
  assignee: null,
  state: { name: "Todo", type: "unstarted" },
  labels: { nodes: [] },
  team: { id: "t1" },
};
const answers: Record<string, unknown> = {
  DeevyWho: {
    viewer: { id: "u1", name: "deevy", displayName: "deevy" },
    organization: { id: "o1", name: "Acme", urlKey: "acme" },
  },
  DeevyTeams: { teams: { nodes: [{ id: "t1", key: "ENG", name: "Engineering" }] } },
  DeevyIssue: { issue: node },
  DeevyIssues: {
    issues: { nodes: [node], pageInfo: { hasPreviousPage: true, startCursor: "c0" } },
  },
  DeevyComments: { issue: { comments: { nodes: [] } } },
  // One label found by name, so both halves of a label change are sent.
  DeevyLabels: { issueLabels: { nodes: [{ id: "l0", name: "done-with", team: { id: "t1" } }] } },
  DeevyLabelCreate: { issueLabelCreate: { success: true, issueLabel: { id: "l1" } } },
  DeevyIssueCreate: { issueCreate: { success: true, issue: node } },
  DeevyCommentCreate: {
    commentCreate: { success: true, comment: { id: "c1", url: "https://linear.app/c1" } },
  },
  DeevyLabelsChange: { issueUpdate: { success: true } },
};

/** The webhook fields `payloads.ts` reads, by the payload type Linear's schema names them in. */
const WEBHOOK_READS: Record<string, string[]> = {
  IssueWebhookPayload: [
    "id",
    "identifier",
    "url",
    "title",
    "description",
    "state",
    "assignee",
    "assigneeId",
    "parentId",
    "delegateId",
    "labels",
    "updatedAt",
    "teamId",
  ],
  CommentWebhookPayload: [
    "id",
    "body",
    "issueId",
    "issue",
    "user",
    "userId",
    "botActor",
    "createdAt",
  ],
  WorkflowStateChildWebhookPayload: ["name", "type"],
  UserChildWebhookPayload: ["id", "name", "email"],
  IssueLabelChildWebhookPayload: ["name"],
  IssueChildWebhookPayload: ["id", "teamId"],
  EntityWebhookPayload: ["action", "actor", "data", "type", "url", "webhookTimestamp"],
};

interface Sent {
  name: string;
  query: string;
  variables: Record<string, unknown>;
}

async function recorded(): Promise<Sent[]> {
  const sent: Sent[] = [];
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const address = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
    if (address.endsWith("/oauth/token")) {
      return Response.json({ access_token: "token", expires_in: 3600 });
    }
    const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as {
      query: string;
      variables?: Record<string, unknown>;
    };
    const name = /(?:query|mutation)\s+(\w+)/.exec(body.query)?.[1] ?? "?";
    sent.push({ name, query: body.query, variables: body.variables ?? {} });
    if (!(name in answers)) throw new Error(`the check has no answer for ${name}; add one`);
    return Response.json({ data: answers[name] });
  }) as typeof globalThis.fetch;

  resetLinearTokens();
  const module = createLinearSocket({
    config: { organizationId: "o1" },
    credentials: { clientId: "id", clientSecret: "secret" },
    fetch,
    now: () => new Date(),
  });
  const tracker = module.tracker;
  if (!tracker) throw new Error("a Linear Socket is a tracker");
  const scope = { scopeKey: "t1", teamKey: "ENG" };
  const ref = { externalId: "i1", url: node.url };
  await module.identity();
  await tracker.listContainers();
  await tracker.getIssue(scope, ref);
  await tracker.listIssues(scope, {
    updatedSince: new Date(Date.now() - 3_600_000),
    limit: 20,
    cursor: "c9",
  });
  await tracker.listComments(scope, ref, 50);
  await tracker.createIssue(scope, {
    title: "A part",
    body: "Its words",
    parent: ref,
    labels: ["agent:planner"],
  });
  await tracker.createComment(scope, ref, "Said");
  await tracker.setLabels(scope, ref, { add: ["deevy:awaiting-approval"], remove: ["done-with"] });
  return sent;
}

function problemsWith(
  schema: GraphQLSchema,
  one: Sent,
): { errors: string[]; deprecated: string[] } {
  const document = parse(one.query);
  const errors = validate(schema, document).map((error) => error.message);
  const deprecated = validate(schema, document, [NoDeprecatedCustomRule]).map(
    (error) => error.message,
  );
  const operation = document.definitions.find(
    (definition): definition is OperationDefinitionNode =>
      definition.kind === "OperationDefinition",
  );
  for (const definition of operation?.variableDefinitions ?? []) {
    const name = definition.variable.name.value;
    const type = typeFromAST(schema, definition.type);
    const value = one.variables[name];
    if (!type || !isInputType(type)) {
      errors.push(`$${name} is not an input type Linear has`);
      continue;
    }
    if (value === undefined || value === null) {
      if (isNonNullType(type)) errors.push(`$${name} is required and was not sent`);
      continue;
    }
    validateInputValue(value, type, (error, path) => {
      errors.push(`$${name}${path?.length ? `.${path.join(".")}` : ""}: ${error.message}`);
    });
  }
  return { errors, deprecated };
}

const response = await fetch(SCHEMA_URL);
if (!response.ok) {
  console.error(`Could not read Linear's schema at ${SCHEMA_URL}: ${String(response.status)}`);
  process.exit(2);
}
const schema = buildSchema(await response.text(), { assumeValidSDL: true });
let failed = 0;

for (const one of await recorded()) {
  const { errors, deprecated } = problemsWith(schema, one);
  failed += errors.length;
  console.log(`${errors.length > 0 ? "✗" : "✓"} ${one.name}`);
  for (const error of errors) console.log(`    ${error}`);
  for (const warning of deprecated) console.log(`    deprecated: ${warning}`);
}

for (const [type, reads] of Object.entries(WEBHOOK_READS)) {
  const found = schema.getType(type);
  const fields = found && "getFields" in found ? found.getFields() : null;
  const missing = fields ? reads.filter((field) => !(field in fields)) : reads;
  failed += missing.length;
  console.log(`${missing.length > 0 ? "✗" : "✓"} webhook ${type}`);
  if (!fields) console.log(`    Linear's schema has no type ${type}`);
  else for (const field of missing) console.log(`    no field ${field}`);
}

console.log(
  failed === 0
    ? "\nLinear's schema has everything deevy asks and reads."
    : `\n${String(failed)} problems.`,
);
process.exit(failed === 0 ? 0 : 1);
