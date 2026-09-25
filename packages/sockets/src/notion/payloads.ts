import type { ExternalActor, ExternalIssue, InboundEvent, Scope } from "@deevy/core/sockets";

/**
 * Reading what Notion says (ADR-0024).
 *
 * Notion's webhooks are signals: an event names a page or a comment and
 * carries none of it, so `normalize` says which record or comment to read back
 * (`changed`, `commented`) and the API half reads it through the Project's
 * binding. What a row means — which property is its status, which statuses are
 * closed — is the binding's to say, because every database names its own.
 */

const text = (value: unknown): string => (typeof value === "string" ? value : "");
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** What a binding says about a data source, from `listContainers` (ADR-0024). */
export interface NotionScope {
  /** The data source: one table of rows, and a Project's container. */
  scopeKey: string;
  databaseId?: string;
  titleProperty?: string;
  statusProperty?: string;
  /** Statuses a row is closed in: the ones the data source groups as "Complete". */
  closedValues?: string[];
  labelsProperty?: string;
  peopleProperty?: string;
  /** A relation to a row of the same data source: Notion's sub-items. */
  parentProperty?: string;
  /** Notion's ID property, whose `PREFIX-12` is what a Human types. */
  keyProperty?: string;
}

export function notionScope(scope: Scope): NotionScope {
  const found = scope as Record<string, unknown>;
  const name = (key: string) =>
    typeof found[key] === "string" ? (found[key] as string) : undefined;
  return {
    scopeKey: name("scopeKey") ?? "",
    ...(name("databaseId") ? { databaseId: name("databaseId") } : {}),
    ...(name("titleProperty") ? { titleProperty: name("titleProperty") } : {}),
    ...(name("statusProperty") ? { statusProperty: name("statusProperty") } : {}),
    closedValues: Array.isArray(found.closedValues)
      ? found.closedValues.filter((one): one is string => typeof one === "string")
      : ["Done"],
    ...(name("labelsProperty") ? { labelsProperty: name("labelsProperty") } : {}),
    ...(name("peopleProperty") ? { peopleProperty: name("peopleProperty") } : {}),
    ...(name("parentProperty") ? { parentProperty: name("parentProperty") } : {}),
    ...(name("keyProperty") ? { keyProperty: name("keyProperty") } : {}),
  };
}

/** Rich text as the words it says. */
export function plainText(value: unknown): string {
  return list(value)
    .map((part) => text(record(part).plain_text) || text(record(record(part).text).content))
    .join("");
}

/** The first property of a type, by name. */
function firstOfType(properties: Record<string, unknown>, type: string): string | undefined {
  return Object.entries(properties).find(([, property]) => record(property).type === type)?.[0];
}

/**
 * What a data source's schema says a binding should read: the defaults an
 * admin gets without choosing — the first status property and its "Complete"
 * group, the first multi-select as labels, the first people property, and a
 * relation to its own rows named like a parent.
 */
export function scopeOf(dataSource: unknown): { scope: NotionScope; name: string } | null {
  const found = record(dataSource);
  const id = text(found.id);
  if (!id) return null;
  const properties = record(found.properties);
  const statusProperty = firstOfType(properties, "status");
  const status = record(record(properties[statusProperty ?? ""]).status);
  const options = list(status.options).map(record);
  const complete = list(status.groups)
    .map(record)
    .find((group) => text(group.name).toLowerCase() === "complete");
  const completeIds = new Set(list(complete?.option_ids).map(text));
  const closedValues = options
    .filter((option) => completeIds.has(text(option.id)))
    .map((option) => text(option.name));
  const parentProperty = Object.entries(properties).find(([name, property]) => {
    const relation = record(record(property).relation);
    return (
      record(property).type === "relation" &&
      text(relation.data_source_id) === id &&
      name.toLowerCase().includes("parent")
    );
  })?.[0];
  const databaseId = text(record(found.parent).database_id);
  const titleProperty = firstOfType(properties, "title");
  const labelsProperty = firstOfType(properties, "multi_select");
  const peopleProperty = firstOfType(properties, "people");
  const keyProperty = firstOfType(properties, "unique_id");
  return {
    name: plainText(found.title) || "Untitled",
    scope: {
      scopeKey: id,
      ...(databaseId ? { databaseId } : {}),
      ...(titleProperty ? { titleProperty } : {}),
      ...(statusProperty ? { statusProperty } : {}),
      closedValues: closedValues.length > 0 ? closedValues : ["Done"],
      ...(labelsProperty ? { labelsProperty } : {}),
      ...(peopleProperty ? { peopleProperty } : {}),
      ...(parentProperty ? { parentProperty } : {}),
      ...(keyProperty ? { keyProperty } : {}),
    },
  };
}

/** A page id in the dashed form Notion's API takes, from however it was written. */
export function pageIdOf(value: string): string | null {
  const match =
    /([0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12})(?![0-9a-f])/i.exec(value);
  const hex = match?.[1]?.replaceAll("-", "").toLowerCase();
  if (!hex || hex.length !== 32) return null;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** A page's title, from whichever property is its title. */
export function titleOf(page: unknown): string {
  const properties = record(record(page).properties);
  const name = firstOfType(properties, "title");
  return plainText(record(properties[name ?? ""]).title);
}

/**
 * One row as deevy projects it.
 *
 * Its key is Notion's ID property where the data source has one (`TASK-12`),
 * and otherwise the start of its id: Notion writes no key of its own. Its
 * body is the page's markdown where it was read, and absent where it was not.
 */
export function issueOf(page: unknown, scope: Scope, markdown?: string): ExternalIssue | null {
  const found = record(page);
  const externalId = text(found.id);
  if (!externalId) return null;
  const binding = notionScope(scope);
  const properties = record(found.properties);
  const property = (name: string | undefined, type: string) => {
    const named = name ? record(properties[name]) : {};
    if (named.type === type) return named;
    const first = firstOfType(properties, type);
    return name === undefined && first ? record(properties[first]) : {};
  };

  const unique = record(property(binding.keyProperty, "unique_id").unique_id);
  const number = unique.number;
  const key =
    typeof number === "number"
      ? `${text(unique.prefix) ? `${text(unique.prefix)}-` : ""}${String(number)}`
      : externalId.replaceAll("-", "").slice(0, 8);

  const status = text(record(property(binding.statusProperty, "status").status).name);
  const trashed = found.in_trash === true || found.archived === true;
  const closed = trashed || (binding.closedValues ?? ["Done"]).includes(status);

  const people = list(property(binding.peopleProperty, "people").people).map(record);
  const assignees = people
    .filter((user) => text(user.type) !== "bot")
    .map((user) => ({ login: text(user.name), id: text(user.id) }))
    .filter((user) => user.id.length > 0);
  // The connection's bot among a row's people is the row handed to deevy, as
  // Linear's delegate is: the Project's default Agent answers it.
  const delegate = people.find((user) => text(user.type) === "bot");

  const labels = list(property(binding.labelsProperty, "multi_select").multi_select)
    .map((option) => text(record(option).name))
    .filter((name) => name.length > 0);
  const parent = binding.parentProperty
    ? text(record(list(record(properties[binding.parentProperty]).relation)[0]).id)
    : "";

  return {
    externalId,
    key,
    url: text(found.url),
    title: plainText(record(properties[binding.titleProperty ?? ""]).title) || titleOf(found),
    ...(markdown === undefined ? {} : { body: markdown }),
    state: closed ? "closed" : "open",
    stateName: trashed ? "Deleted" : status || (closed ? "closed" : "open"),
    assignees,
    labels,
    parentExternalId: parent || null,
    delegateId: delegate ? text(delegate.id) || null : null,
    updatedAt: new Date(text(found.last_edited_time) || Date.now()),
  };
}

/** Who did it, as a webhook names them: an id and a kind, nothing more. */
function actorOf(authors: unknown): ExternalActor | null {
  const first = record(list(authors)[0]);
  const id = text(first.id);
  if (!id) return null;
  return { login: "", id, isBot: text(first.type) !== "person" };
}

/** The page events that mean a row may have changed, whichever way. */
const pageEvents = new Set([
  "page.created",
  "page.properties_updated",
  "page.content_updated",
  "page.moved",
  "page.deleted",
  "page.undeleted",
]);

/** What one delivery means. Pure: which record or comment to read back, or why nothing. */
export function normalizeNotion(eventName: string, payload: unknown): InboundEvent[] {
  const body = record(payload);
  const type = text(body.type) || eventName;
  const entity = record(body.entity);
  const data = record(body.data);

  if (pageEvents.has(type)) {
    const parent = record(data.parent);
    const parentType = text(parent.type);
    if (parentType !== "database" && parentType !== "data_source") {
      return [{ kind: "ignored", why: `a ${type} on a page that is not a row of a database` }];
    }
    return [
      {
        kind: "changed",
        scopeKey: text(parent.data_source_id) || text(parent.id),
        issueExternalId: text(entity.id),
        actor: actorOf(body.authors),
      },
    ];
  }

  if (type === "comment.created") {
    const pageId = text(data.page_id);
    if (!pageId) return [{ kind: "ignored", why: "a comment that is not on a page" }];
    return [{ kind: "commented", issueExternalId: pageId, commentExternalId: text(entity.id) }];
  }

  return [{ kind: "ignored", why: `a ${type} delivery, which deevy does not read` }];
}
