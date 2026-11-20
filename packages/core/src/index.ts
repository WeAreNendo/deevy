export { buildContext, createApp, type App, type AppOptions } from "./app.ts";
// Where the API and the MCP surface are mounted, for a client outside this package.
export { API_PATH, MCP_PATH } from "./auth.ts";
export { basePathOf, type BasePath } from "./base-path.ts";
export { providersFromEnv, type ProviderVariables } from "./provider-env.ts";
export {
  relaySignInCallback,
  signInRelayFromEnv,
  unwrapRelayState,
  wrapRelayState,
  type SignInRelayServer,
  type SignInRelayVariables,
} from "./sign-in-relay.ts";
export {
  accountLinkingOf,
  apiKeyPrefix,
  bearerApiKey,
  bearerToken,
  bootstrapWorkspace,
  createAuth,
  MISSING_AUTH_SECRET,
  signInProviders,
  slugify,
  type Auth,
  type AuthEnv,
  type AuthLogger,
  type AuthProviders,
  type OAuthClient,
  type Session,
  type SignInProvider,
  type SignInProviderKind,
} from "./auth.ts";
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
export { describeError, withoutBoundValues } from "./errors.ts";
export { dataHeaders, pageHeaders, pagePolicy } from "./headers.ts";
export { onEventAppended, type LiveOptions, type LiveReader, type LiveSocket } from "./live.ts";
export { createDeevyMcp, type DeevyMcp, type DeevyMcpOptions } from "./mcp/server.ts";
export { generateSpec } from "./openapi.ts";
export {
  resolvePrincipal,
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
export { signPayload, verifySignature, type VerifyInput } from "./signature.ts";
export { webhookBody } from "./webhooks.ts";
export {
  defaultDeliveryLimit,
  defaultMaxPasses,
  defaultSilenceMs,
  defaultSweepLimit,
  deliverDueChatMessages,
  deliverDueWebhooks,
  deliverWebhook,
  maxDeliveryAttempts,
  maxWebhookAttempts,
  runDueWork,
  sweepStaleRuns,
  type DeliverDueChatMessagesOptions,
  type DeliverDueWebhooksOptions,
  type DeliverWebhookOptions,
  type DeliveryResult,
  type DueWorkLimits,
  type DueWorkResult,
  type RunDueWorkOptions,
  type SweepResult,
  type SweepStaleRunsOptions,
} from "./work.ts";
export {
  invitationsSince,
  limitWindowMs,
  limitWindowStart,
  type WorkspaceLimits,
} from "./limits.ts";
export { idPrefixes, isId, newId, type IdKind } from "./ids.ts";
/**
 * Sealing, for the entries and for a provider package's own tests: what goes
 * into a Socket's columns is what `sockets.connect` would have put there
 * (secrets.ts).
 */
export { openSecret, requireSealingSecret, sealSecret, signState, verifyState } from "./secrets.ts";
export {
  parseIssueRef,
  routeIssueTo,
  upsertProjection,
  type IssueRef,
  type ProjectionInput,
  type ProjectionResult,
} from "./issues.ts";
export { requireSocket, requireTracker, scopeKeyOf, socketModuleFor } from "./sockets/registry.ts";
// What a tracker saying something does inside deevy, so a seed can play a
// delivery without a network (seed.ts).
export {
  applyInbound,
  type ApplyInboundOptions,
  type ApplyInboundResult,
} from "./sockets/apply.ts";
export type * from "./sockets/port.ts";
