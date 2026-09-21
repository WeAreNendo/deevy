/**
 * The providers this build can speak (ADR-0024).
 *
 * An entry imports what it wants and hands it to `createApp({ sockets })`; the
 * core holds the port types and never this package, which is what keeps a
 * provider's HTTP client out of the core and inside the bundle the Workers
 * build already checks.
 *
 * `stub` is not a tool (src/stub). An entry that registers it in production is
 * the thing that is wrong, so the entry is where that is refused.
 */
import type { SocketModules } from "@deevy/core/sockets";
import { createStubSocket } from "./stub/index.ts";

export * from "./stub/index.ts";

/**
 * The providers an entry may register.
 *
 * `stub` is not a tool: it is the in-process provider the tests, the seed and
 * the acceptance walk play. `devStub` says whether this deployment is allowed
 * one, and the entry is what answers — a module that decided where it may run
 * could not be tested anywhere.
 */
export function socketModules({ devStub = false } = {}): SocketModules {
  return devStub ? { stub: createStubSocket } : {};
}
