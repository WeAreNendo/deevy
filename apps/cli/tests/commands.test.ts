import { router } from "@deevy/core/router";
import { describe, expect, it } from "vite-plus/test";
import { commandPath, commandsFor, parametersOf } from "../src/commands.ts";

const commands = commandsFor(router);
const byOperation = new Map(commands.map((command) => [command.operation, command]));

describe("the command list", () => {
  it("takes every operation, not the curated few MCP takes", () => {
    // The MCP projection filters to `mcp: true` because a model's context
    // window is finite. A command line's is not, so anything missing here is a
    // gap rather than a decision — and `issues.get` carrying `mcp` while
    // `agents.keys.issue` does not is exactly the pair that proves it.
    expect(byOperation.has("issues.get")).toBe(true);
    expect(byOperation.has("agents.keys.issue")).toBe(true);
    expect(commands.length).toBeGreaterThan(80);
  });

  it("is in stable order, so a diff of it moves only when the surface does", () => {
    expect(commands.map((command) => command.operation)).toEqual(
      commands.map((command) => command.operation).sort((a, b) => a.localeCompare(b)),
    );
  });

  it("gives every command a unique name", () => {
    const names = commands.map((command) => command.path.join(" "));
    expect(new Set(names).size).toBe(names.length);
  });

  it("carries a summary for every command, because that is the help text", () => {
    expect(commands.filter((command) => command.summary.trim() === "")).toEqual([]);
  });

  it("carries both schemas for every command", () => {
    const missing = commands.filter(
      (command) => command.inputSchema === undefined || command.outputSchema === undefined,
    );
    expect(missing.map((command) => command.operation)).toEqual([]);
  });
});

describe("a command's name", () => {
  it("makes words out of a dotted, camelCased operation", () => {
    expect(commandPath("issues.setLabels")).toEqual(["issues", "set-labels"]);
    expect(commandPath("issues.get")).toEqual(["issues", "get"]);
    expect(commandPath("agents.keys.issue")).toEqual(["agents", "keys", "issue"]);
    expect(commandPath("oauthClients.revoke")).toEqual(["oauth-clients", "revoke"]);
  });
});

describe("a command's positional arguments", () => {
  it("are the path parameters, in the order the path names them", () => {
    expect(parametersOf("/issues/{key}/labels")).toEqual(["key"]);
    expect(parametersOf("/agents/{memberId}/keys/{keyId}")).toEqual(["memberId", "keyId"]);
    expect(parametersOf("/issues")).toEqual([]);
  });

  it("are read off the real operations", () => {
    expect(byOperation.get("issues.setLabels")?.parameters).toEqual(["key"]);
    expect(byOperation.get("issues.create")?.parameters).toEqual([]);
  });
});

describe("what the CLI cannot do", () => {
  /**
   * The four operations no credential a CLI can hold will ever satisfy: they
   * want a cookie session, which means a Human in deevy's own browser
   * (ADR-0010). They stay in the list so the CLI can explain itself rather than
   * relaying a bare FORBIDDEN — but the list must not grow without somebody
   * deciding it should, so it is written down here.
   */
  it("knows which operations want a Human in a browser", () => {
    const sessionOnly = commands
      .filter((command) => command.sessionOnly)
      .map((command) => command.operation);
    expect(sessionOnly).toEqual([
      "gates.approve",
      "gates.reject",
      "oauthClients.list",
      "oauthClients.revoke",
    ]);
  });

  it("marks the operations only an Agent may call", () => {
    const agentsOnly = commands.filter((command) => command.agentsOnly);
    expect(agentsOnly.length).toBeGreaterThan(0);
    // agentsOnly is only sayable beside `agents`, and the registry makes that a
    // compile error; this is the same claim at runtime, over the real router.
    expect(agentsOnly.filter((command) => !command.agents)).toEqual([]);
  });
});
