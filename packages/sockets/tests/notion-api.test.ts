import type { TrackerSocket } from "@deevy/core/sockets";
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

type Answer = object | Response | ((asked: Asked) => object | Response | null);

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
    return said instanceof Response ? said : Response.json(said);
  }) as typeof fetch;

  const module = createNotionSocket({
    config: { workspaceId: WORKSPACE, workspaceName: "Acme" },
    credentials: { token: "ntn_deevy_integration_secret" },
    fetch: fetchImpl,
    now: () => new Date("2026-09-24T10:00:00Z"),
  });
  const { tracker } = module;
  if (!tracker?.getIssue || !tracker.getComment || !tracker.listContainers) {
    throw new Error(
      "a Notion Socket reads a row back, and its comments, and offers its data sources",
    );
  }
  // Checked just above: what Notion's deliveries only name, it reads back.
  const reads = tracker as TrackerSocket &
    Required<Pick<TrackerSocket, "getIssue" | "getComment" | "listContainers">>;
  return { module, tracker: reads, asked };
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

  it("is never a person: a personal access token would write as them, and drop their comments", async () => {
    const { module } = notionReturning({
      // What a personal access token answers: the Human who made it, not a bot.
      "GET /v1/users/me": {
        object: "user",
        id: GRACE,
        type: "person",
        name: "Grace Hopper",
        avatar_url: null,
        person: { email: "grace@example.com" },
      },
    });

    await expect(module.identity()).rejects.toThrow(
      "This is Grace Hopper's personal access token: deevy would write as them, and take their comments for its own. Make an internal connection in Notion's Developer portal and paste its installation access token.",
    );
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

    expect(await tracker.getComment(scope, ref, "cmt-1")).toEqual({
      externalId: "cmt-1",
      url: page.url,
      body: "/approve cap it at the basket total",
      author: { login: "Grace Hopper", id: GRACE, isBot: false, email: "grace@example.com" },
      createdAt: new Date("2026-09-24T10:21:00.000Z"),
    });
    expect(await tracker.getComment(scope, ref, "cmt-gone")).toBeNull();
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

  it("says what Notion said when it refuses, in its words and then its code", async () => {
    const { module, tracker } = notionReturning({
      // What api.notion.com answers a made-up secret, byte for byte but the request id.
      "GET /v1/users/me": Response.json(
        {
          object: "error",
          status: 401,
          code: "unauthorized",
          message: "API token is invalid.",
          request_id: "5d1c2f0e-7a3b-4c8d-9e1f-2a3b4c5d6e7f",
        },
        { status: 401 },
      ),
    });

    await expect(module.identity()).rejects.toThrow(
      "API token is invalid. (unauthorized, GET /users/me)",
    );
    await expect(tracker.getIssue(scope, ref)).rejects.toThrow(
      `Could not find it. (object_not_found, GET /pages/${PAGE})`,
    );
  });

  it("says what failed when Notion answers with no words", async () => {
    const { module } = notionReturning({
      "GET /v1/users/me": new Response("upstream timed out", { status: 502 }),
    });

    await expect(module.identity()).rejects.toThrow("Notion answered 502 (GET /users/me)");
  });
});

describe("a row's content", () => {
  it("says where Notion left part of a page out, and where the whole page is", async () => {
    const gaps = {
      ...markdown,
      markdown:
        'A 10% coupon takes the total below zero.\n\n<unknown url="https://www.notion.so/acme/Coupon-9f8e7d6c5b4a4f3e8d2c1b0a9f8e7d6c" alt="bookmark"/>',
      unknown_block_ids: ["9f8e7d6c-5b4a-4f3e-8d2c-1b0a9f8e7d6c"],
    };
    const { tracker } = notionReturning({
      [`GET /v1/pages/${PAGE}`]: page,
      [`GET /v1/pages/${PAGE}/markdown`]: gaps,
    });

    expect((await tracker.getIssue(scope, ref)).body).toBe(
      `${gaps.markdown}\n\n> Notion left 1 block of this page out, marked \`<unknown>\` above: one not shared with deevy, or of a kind Notion does not write as markdown. The page is at ${page.url}.`,
    );
  });

  it("says when Notion stopped reading a page before its end", async () => {
    const cut = {
      ...markdown,
      markdown: 'Step 1.\n\n<unknown url="https://www.notion.so/acme/x" alt="paragraph"/>',
      truncated: true,
      unknown_block_ids: [
        "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
        "1b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e",
      ],
    };
    const { tracker } = notionReturning({
      [`GET /v1/pages/${PAGE}`]: page,
      [`GET /v1/pages/${PAGE}/markdown`]: cut,
    });

    expect((await tracker.getIssue(scope, ref)).body).toBe(
      `${cut.markdown}\n\n> Notion stopped reading this page at about 20,000 blocks, so 2 blocks are missing here, marked \`<unknown>\` above. The whole page is at ${page.url}.`,
    );

    const { tracker: unlisted } = notionReturning({
      [`GET /v1/pages/${PAGE}`]: page,
      [`GET /v1/pages/${PAGE}/markdown`]: { ...cut, markdown: "Step 1.", unknown_block_ids: [] },
    });
    expect((await unlisted.getIssue(scope, ref)).body).toBe(
      `Step 1.\n\n> Notion stopped reading this page at about 20,000 blocks, so its end is missing here. The whole page is at ${page.url}.`,
    );
  });

  it("asks Notion nothing for a reference that names no Notion page", async () => {
    const { tracker, asked } = notionReturning({});

    await expect(
      tracker.getIssue(scope, { externalId: "", url: "https://example.com/not-notion" }),
    ).rejects.toThrow("names no Notion page");
    expect(asked).toEqual([]);
  });
});
