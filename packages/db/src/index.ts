import type { SQLiteAsyncDatabase } from "drizzle-orm/sqlite-core";
import type { relations } from "./relations.ts";

export * from "./schema/index.ts";
export { relations } from "./relations.ts";

/**
 * The database handle the core works with. Both `drizzle-orm/node-sqlite` and
 * `drizzle-orm/d1` produce one of these, so nothing outside packages/adapters
 * knows which driver is underneath (ADR-0006).
 */
export type Db = SQLiteAsyncDatabase<"sync" | "async", unknown, typeof relations>;

export type Workspace = typeof import("./schema/workspace.ts").workspace.$inferSelect;
export type Member = typeof import("./schema/workspace.ts").member.$inferSelect;
export type User = typeof import("./schema/auth.ts").user.$inferSelect;
export type Event = typeof import("./schema/event.ts").event.$inferSelect;
export type AllowlistRule = typeof import("./schema/allowlist.ts").allowlistRule.$inferSelect;
export type Invitation = typeof import("./schema/invitation.ts").invitation.$inferSelect;
export type Socket = typeof import("./schema/socket.ts").socket.$inferSelect;
export type Project = typeof import("./schema/project.ts").project.$inferSelect;
export type Agent = typeof import("./schema/agent.ts").agent.$inferSelect;
export type Run = typeof import("./schema/run.ts").run.$inferSelect;
export type Channel = typeof import("./schema/channel.ts").channel.$inferSelect;
export type Delivery = typeof import("./schema/delivery.ts").delivery.$inferSelect;
export type WebhookSubscription =
  typeof import("./schema/webhook.ts").webhookSubscription.$inferSelect;
export type RoutingRule = typeof import("./schema/channel.ts").routingRule.$inferSelect;
export type NotificationPreference =
  typeof import("./schema/channel.ts").notificationPreference.$inferSelect;
export type Activity = typeof import("./schema/run.ts").activity.$inferSelect;
export type ProjectGrant = typeof import("./schema/agent.ts").projectGrant.$inferSelect;
export type Issue = typeof import("./schema/issue.ts").issue.$inferSelect;
export type Notification = typeof import("./schema/notification.ts").notification.$inferSelect;
export type IssueLink = typeof import("./schema/link.ts").issueLink.$inferSelect;
