import { describe, expect, it } from "vite-plus/test";
import { createNotionSocket } from "../src/notion/index.ts";
import page from "./fixtures/notion/page.json" with { type: "json" };
import dataSource from "./fixtures/notion/data_source.json" with { type: "json" };

/**
 * What the Notion module asks Notion, and what it makes of the answers.
 *
 * A fake answers `METHOD /v1/path` with Notion's documented shapes and writes
 * down what was asked — never the network. The binding's own words decide what
 * a row says: which property is its title, its status, its labels, its people
 * and its parent, and which statuses count as closed.
 */
const WORKSPACE = "1b2c3d4e-5f60-4718-8293-a4b5c6d7e8f9";
const DATA_SOURCE = dataSource.id;
const PAGE = page.id;
const GRACE = "c7c11cca-1d73-471d-9b6e-bdef51470190";
const BOT = "2f4e6a8c-0b1d-4e3f-a5b7-c9d1e3f5a7b9";
const ref = { externalId: PAGE, url: page.url };

/** The binding `listContainers` offers for the fixture's data source. */
const scope = {
  scopeKey: DATA_SOURCE,
  databaseId: "248104cd-477e-80af-bc30-000bd72bee7f",
  titleProperty: "Task name",
  statusProperty: "Status",
  closedValues: ["Done", "Won't do"],
  labelsProperty: "Tags",
  peopleProperty: "Assignee",
  parentProperty: "Parent item",
  keyProperty: "ID",
};

interface Asked {
  method: string;
  path: string;
  headers: Headers;
  body: Record<string, unknown> | undefined;
}

type Answer = object | ((asked: Asked) => object | null);

/** A Notion that answers what each `METHOD /path` is recorded to answer. */
function notionReturning(answers: Record<string, Answer>) {
  const asked: Asked[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? "GET";
    const path = url.replace("https://api.notion.com", "");
    const one: Asked = {
      method,
      path,
      headers: new Headers(init?.headers),
      body:
        typeof init?.body === "string"
          ? (JSON.parse(init.body) as Record<string, unknown>)
          : undefined,
    };
    asked.push(one);
    const answer = answers[`${method} ${path}`] ?? answers[`${method} ${path.split("?")[0] ?? ""}`];
    const said = typeof answer === "function" ? answer(one) : answer;
    if (said === undefined || said === null) {
      return Response.json(
        { object: "error", status: 404, code: "object_not_found", message: "Could not find it." },
        { status: 404 },
      );
    }
    return Response.json(said);
  }) as typeof fetch;

  const module = createNotionSocket({
    config: { workspaceId: WORKSPACE, workspaceName: "Acme" },
    credentials: { token: "ntn_deevy_integration_secret" },
    fetch: fetchImpl,
    now: () => new Date("2026-09-24T10:00:00Z"),
  });
  if (!module.tracker || !module.docs) throw new Error("a Notion Socket is a tracker and docs");
  return { module, tracker: module.tracker, docs: module.docs, asked };
}

const markdown = {
  object: "page_markdown",
  id: PAGE,
  markdown: "A 10% coupon takes the total below zero.\n\n## Seen\n\n- on staging",
  truncated: false,
  unknown_block_ids: [],
};

describe("who deevy is on Notion", () => {
  it("is the integration's own bot, asked with its secret and Notion's current version", async () => {
    const { module, asked } = notionReturning({
      "GET /v1/users/me": {
        object: "user",
        id: BOT,
        name: "deevy",
        type: "bot",
        bot: {
          owner: { type: "workspace", workspace: true },
          workspace_id: WORKSPACE,
          workspace_name: "Acme",
        },
      },
    });

    expect(await module.identity()).toEqual({
      login: "deevy",
      id: BOT,
      mentionHandle: "@deevy",
      learned: { workspaceId: WORKSPACE, workspaceName: "Acme" },
    });
    expect(asked[0]?.headers.get("authorization")).toBe("Bearer ntn_deevy_integration_secret");
    expect(asked[0]?.headers.get("notion-version")).toBe("2026-03-11");
    // Notion's accounts are nobody's sign-in and have no link of their own:
    // an address a Member verified is the most Notion offers (ADR-0025).
    expect(module.identityScope).toEqual({ instance: WORKSPACE });
    expect(module.accountLink).toBeUndefined();
  });
});

describe("the tracker", () => {
  it("offers each data source the integration can see, with what its properties mean", async () => {
    const { tracker, asked } = notionReturning({ "POST /v1/search": { results: [dataSource] } });

    expect(await tracker.listContainers()).toEqual([
      { scope, scopeKey: DATA_SOURCE, name: "Tasks" },
    ]);
    expect(asked[0]?.body).toMatchObject({ filter: { property: "object", value: "data_source" } });
  });

  it("reads a row as a record: its ID, its title, its status, its tags, its people, its content", async () => {
    const { tracker, asked } = notionReturning({
      [`GET /v1/pages/${PAGE}`]: page,
      [`GET /v1/pages/${PAGE}/markdown`]: markdown,
    });

    const issue = await tracker.getIssue(scope, ref);

    expect(asked.map((one) => one.path)).toEqual([
      `/v1/pages/${PAGE}`,
      `/v1/pages/${PAGE}/markdown`,
    ]);
    expect(issue).toEqual({
      externalId: PAGE,
      key: "TASK-12",
      url: page.url,
      title: "Checkout totals are wrong with a coupon",
      body: markdown.markdown,
      state: "open",
      stateName: "Not started",
      assignees: [{ login: "Grace Hopper", id: GRACE }],
      labels: ["Bug", "agent:planner"],
      parentExternalId: null,
      delegateId: null,
      updatedAt: new Date("2026-09-24T09:14:00.000Z"),
    });
  });

  it("is closed in a status the data source groups as complete, and when it is in the trash", async () => {
    const done = {
      ...page,
      properties: {
        ...page.properties,
        Status: { ...page.properties.Status, status: { id: "f8a4c2e6", name: "Won't do" } },
      },
    };
    const trashed = { ...page, in_trash: true };
    for (const [row, stateName] of [
      [done, "Won't do"],
      [trashed, "Deleted"],
    ] as const) {
      const { tracker } = notionReturning({
        [`GET /v1/pages/${PAGE}`]: row,
        [`GET /v1/pages/${PAGE}/markdown`]: markdown,
      });
      expect(await tracker.getIssue(scope, ref)).toMatchObject({ state: "closed", stateName });
    }
  });

  it("knows its parent, and the integration among its people as whom it was handed to", async () => {
    const nested = {
      ...page,
      properties: {
        ...page.properties,
        "Parent item": { ...page.properties["Parent item"], relation: [{ id: "parent-page" }] },
        Assignee: {
          ...page.properties.Assignee,
          people: [...page.properties.Assignee.people, { object: "user", id: BOT, type: "bot" }],
        },
      },
    };
    const { tracker } = notionReturning({
      [`GET /v1/pages/${PAGE}`]: nested,
      [`GET /v1/pages/${PAGE}/markdown`]: markdown,
    });

    expect(await tracker.getIssue(scope, ref)).toMatchObject({
      parentExternalId: "parent-page",
      delegateId: BOT,
      assignees: [{ login: "Grace Hopper", id: GRACE }],
    });
  });

  it("lists what changed since, oldest change first, without reading every page's content", async () => {
    const { tracker, asked } = notionReturning({
      [`POST /v1/data_sources/${DATA_SOURCE}/query`]: {
        object: "list",
        results: [page],
        next_cursor: "cursor-2",
        has_more: true,
      },
    });

    const listed = await tracker.listIssues(scope, {
      updatedSince: new Date("2026-09-24T09:00:00Z"),
      cursor: null,
      limit: 20,
    });

    expect(asked).toHaveLength(1);
    expect(asked[0]?.body).toEqual({
      // On or after: Notion keeps edit times to the minute, and an edit in the
      // same minute as the newest one deevy holds must not be skipped.
      filter: {
        timestamp: "last_edited_time",
        last_edited_time: { on_or_after: "2026-09-24T09:00:00.000Z" },
      },
      sorts: [{ timestamp: "last_edited_time", direction: "ascending" }],
      page_size: 20,
    });
    expect(listed.nextCursor).toBe("cursor-2");
    expect(listed.issues[0]).toMatchObject({ key: "TASK-12" });
    // Content is not in a query's answer, and deevy keeps the body it had.
    expect(listed.issues[0]?.body).toBeUndefined();
  });

  it("reads one comment back with who wrote it, and the address Notion reports for them", async () => {
    const { tracker } = notionReturning({
      "GET /v1/comments/cmt-1": {
        object: "comment",
        id: "cmt-1",
        discussion_id: "disc-1",
        created_time: "2026-09-24T10:21:00.000Z",
        created_by: { object: "user", id: GRACE },
        rich_text: [
          { type: "text", plain_text: "/approve " },
          { type: "text", plain_text: "cap it at the basket total" },
        ],
      },
      [`GET /v1/users/${GRACE}`]: {
        object: "user",
        id: GRACE,
        name: "Grace Hopper",
        type: "person",
        person: { email: "grace@example.com" },
      },
    });

    expect(await tracker.getComment?.(scope, ref, "cmt-1")).toEqual({
      externalId: "cmt-1",
      url: page.url,
      body: "/approve cap it at the basket total",
      author: { login: "Grace Hopper", id: GRACE, isBot: false, email: "grace@example.com" },
      createdAt: new Date("2026-09-24T10:21:00.000Z"),
    });
    expect(await tracker.getComment?.(scope, ref, "cmt-gone")).toBeNull();
  });

  it("reads a record's comments, with an app's marked as a machine's", async () => {
    const { tracker, asked } = notionReturning({
      "GET /v1/comments": {
        results: [
          {
            id: "cmt-1",
            created_time: "2026-09-24T10:21:00.000Z",
            created_by: { object: "user", id: GRACE },
            rich_text: [{ plain_text: "Is this the spring coupon?" }],
          },
          {
            id: "cmt-2",
            created_time: "2026-09-24T10:22:00.000Z",
            created_by: { object: "user", id: BOT },
            rich_text: [{ plain_text: "Waiting on a ruling." }],
          },
        ],
        has_more: false,
      },
      [`GET /v1/users/${GRACE}`]: { id: GRACE, name: "Grace Hopper", type: "person", person: {} },
      [`GET /v1/users/${BOT}`]: { id: BOT, name: "deevy", type: "bot", bot: {} },
    });

    const comments = await tracker.listComments(scope, ref, 20);

    expect(asked[0]?.path).toBe(`/v1/comments?block_id=${PAGE}&page_size=20`);
    expect(comments.map((one) => one.author)).toEqual([
      { login: "Grace Hopper", id: GRACE, isBot: false },
      { login: "deevy", id: BOT, isBot: true },
    ]);
  });

  it("opens a row under its parent, with its labels and its content as markdown", async () => {
    const { tracker, asked } = notionReturning({
      "POST /v1/pages": { ...page, id: "new-page" },
    });

    const created = await tracker.createIssue(scope, {
      title: "Cap the coupon",
      body: "Split out of TASK-12.",
      parent: ref,
      labels: ["agent:builder"],
    });

    expect(asked[0]?.body).toEqual({
      parent: { data_source_id: DATA_SOURCE },
      properties: {
        "Task name": { title: [{ text: { content: "Cap the coupon" } }] },
        Tags: { multi_select: [{ name: "agent:builder" }] },
        "Parent item": { relation: [{ id: PAGE }] },
      },
      markdown: "Split out of TASK-12.",
    });
    expect(created).toMatchObject({ externalId: "new-page", parentLinked: true });
  });

  it("comments in markdown, as the integration", async () => {
    const { tracker, asked } = notionReturning({ "POST /v1/comments": { id: "cmt-9" } });

    const posted = await tracker.createComment(scope, ref, "Approved: **1 of 2**.");

    expect(asked[0]?.body).toEqual({
      parent: { page_id: PAGE },
      markdown: "Approved: **1 of 2**.",
    });
    expect(posted).toEqual({ externalId: "cmt-9", url: page.url });
  });

  it("sets its labels property to what it was, plus and minus the change, and only if it moved", async () => {
    const { tracker, asked } = notionReturning({
      [`GET /v1/pages/${PAGE}`]: page,
      [`PATCH /v1/pages/${PAGE}`]: page,
    });

    await tracker.setLabels(scope, ref, { add: ["deevy:awaiting-approval"], remove: ["Bug"] });
    await tracker.setLabels(scope, ref, { add: ["Bug"], remove: ["never-there"] });

    const patches = asked.filter((one) => one.method === "PATCH");
    expect(patches.map((one) => one.body)).toEqual([
      {
        properties: {
          Tags: { multi_select: [{ name: "agent:planner" }, { name: "deevy:awaiting-approval" }] },
        },
      },
    ]);
  });

  it("labels nothing in a data source with no labels property", async () => {
    const { tracker, asked } = notionReturning({});

    await tracker.setLabels({ ...scope, labelsProperty: undefined }, ref, {
      add: ["deevy:awaiting-approval"],
      remove: [],
    });

    expect(asked).toEqual([]);
  });

  it("says what Notion said when it refuses", async () => {
    const { tracker } = notionReturning({});

    await expect(tracker.getIssue(scope, ref)).rejects.toThrow("Notion answered 404");
  });
});

describe("documents", () => {
  it("are a page read as markdown, named by its URL or its id", async () => {
    const plan = {
      ...page,
      id: "3c5d7e9f-1a2b-4c3d-8e4f-5a6b7c8d9e0f",
      parent: { type: "page_id", page_id: "somewhere" },
      properties: {
        title: {
          id: "title",
          type: "title",
          title: [{ type: "text", plain_text: "Checkout plan" }],
        },
      },
      url: "https://www.notion.so/acme/Checkout-plan-3c5d7e9f1a2b4c3d8e4f5a6b7c8d9e0f",
    };
    const { docs, asked } = notionReturning({
      [`GET /v1/pages/${plan.id}`]: plan,
      [`GET /v1/pages/${plan.id}/markdown`]: {
        ...markdown,
        markdown: "# Checkout plan\n\nCap it.",
      },
    });

    const byUrl = await docs.readPage({ url: `${plan.url}?pvs=4` });
    const byId = await docs.readPage({ externalId: plan.id });

    expect(byUrl).toEqual({
      title: "Checkout plan",
      markdown: "# Checkout plan\n\nCap it.",
      url: plan.url,
    });
    expect(byId).toEqual(byUrl);
    expect(asked[0]?.path).toBe(`/v1/pages/${plan.id}`);
  });

  it("refuses a URL that names no Notion page", async () => {
    const { docs } = notionReturning({});

    await expect(docs.readPage({ url: "https://example.com/not-notion" })).rejects.toThrow(
      "names no Notion page",
    );
  });
});
