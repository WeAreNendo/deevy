export { buildContext, createApp, type App, type AppOptions } from "./app.ts";
// The two protected resources, for anything outside this package that builds
// a context: which surface a request reached decides the audience it accepts.
export { API_PATH, MCP_PATH, type ResourcePath } from "./auth.ts";
export {
  accountLinkingOf,
  apiKeyPrefix,
  bearerApiKey,
  bearerToken,
  bootstrapWorkspace,
  createAuth,
  signInProviders,
  slugify,
  type Auth,
  type AuthEnv,
  type AuthProviders,
  type OAuthClient,
  type Session,
  type SignInProvider,
  type SignInProviderKind,
} from "./auth.ts";
export {
  boundMetadataResponse,
  checkMetadataUrl,
  createClientMetadataFetch,
  fetchClientMetadataResource,
  isPubliclyRoutable,
  type ClientMetadataFetchOptions,
  type MetadataResourceFetch,
} from "./cimd.ts";
export {
  appendEvent,
  type EventInput,
  type EventKind,
  type EventPayload,
  type EventSource,
} from "./events.ts";
export {
  discardingJobQueue,
  type Cron,
  type CronStop,
  type Job,
  type JobKind,
  type JobQueue,
} from "./jobs.ts";
export { type LiveOptions } from "./live.ts";
export { createDeevyMcp, type DeevyMcp, type DeevyMcpOptions } from "./mcp/server.ts";
export { generateSpec } from "./openapi.ts";
export {
  resolvePrincipal,
  type JwksFetch,
  type ResolvedPrincipal,
  type ResolvePrincipalOptions,
} from "./principal.ts";
export { router, type AppRouter } from "./operations/index.ts";
export {
  defineOperation,
  getOperationMeta,
  type AppContext,
  type AuthRule,
  type OperationDef,
  type OperationMeta,
  type Principal,
} from "./operations/registry.ts";
export { EventSchema, MemberSchema, UserSchema, WorkspaceSchema } from "./schemas.ts";
export {
  issueUrl,
  postSlackMessage,
  slackMessage,
  type FetchLike,
  type SlackPayload,
} from "./slack.ts";
export { signPayload, verifySignature, webhookBody, type VerifyInput } from "./webhooks.ts";
export {
  defaultDeliveryLimit,
  defaultMaxPasses,
  defaultSilenceMs,
  defaultSweepLimit,
  deliverDueChannelMessages,
  deliverDueWebhooks,
  deliverWebhook,
  maxDeliveryAttempts,
  maxWebhookAttempts,
  runDueWork,
  sweepSchedules,
  remindAboutGates,
  sweepStaleRuns,
  type DeliverDueChannelMessagesOptions,
  type DeliverDueWebhooksOptions,
  type DeliverWebhookOptions,
  type DeliveryResult,
  type DueWorkLimits,
  type DueWorkResult,
  type RunDueWorkOptions,
  type ScheduleSweepResult,
  type SweepResult,
  type SweepSchedulesOptions,
  type SweepStaleRunsOptions,
} from "./work.ts";
export { idPrefixes, isId, newId, type IdKind } from "./ids.ts";
export {
  parseIssueRef,
  routeIssueTo,
  upsertProjection,
  type IssueRef,
  type ProjectionInput,
  type ProjectionResult,
} from "./issues.ts";
export {
  requireForge,
  requireSocket,
  requireTracker,
  scopeKeyOf,
  socketModuleFor,
} from "./sockets/registry.ts";
export type * from "./sockets/port.ts";
