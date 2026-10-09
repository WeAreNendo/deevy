/**
 * deevy's own lint rules, loaded by oxlint as a JS plugin from the root
 * vite.config.ts. Plain JavaScript with no imports, so oxlint can load it
 * without a build and without a package around it.
 */

/** A drizzle `sql` template, or one of the helpers that build one (`sql.raw`, `sql.join`). */
function isSql(node) {
  if (!node) return false;
  if (node.type === "TaggedTemplateExpression") return isSqlTag(node.tag);
  if (node.type === "CallExpression") return isSqlTag(node.callee);
  return false;
}

function isSqlTag(node) {
  if (node.type === "Identifier") return node.name === "sql";
  return node.type === "MemberExpression" && isSqlTag(node.object);
}

/** `db`, `tx`, or anything's `.db` (`context.db`, `source.db`): the database itself. */
function isDatabase(node) {
  if (node.type === "Identifier") return node.name === "db" || node.name === "tx";
  return (
    node.type === "MemberExpression" &&
    !node.computed &&
    node.property.type === "Identifier" &&
    node.property.name === "db"
  );
}

/**
 * A raw `db.get(query)` reads one row in drizzle's "objects" mode, which the
 * Durable Object driver answers with the cursor's `one()`: when no row is
 * found it throws, where the Node driver hands back undefined. The core runs
 * on both (ADR-0028), so it reads with `db.all(query)` and takes the first row,
 * or with a query builder, whose `.get()` returns undefined on either.
 */
const noRawDbGet = {
  meta: {
    type: "problem",
    docs: { description: "Disallow a raw db.get(sql), which throws on no row on a Durable Object" },
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== "MemberExpression" || callee.computed) return;
        if (callee.property.type !== "Identifier" || callee.property.name !== "get") return;
        if (!isDatabase(callee.object) && !isSql(node.arguments[0])) return;
        context.report({
          node,
          message:
            "A raw db.get(...) throws when no row is found on the Durable Object driver. " +
            "Use db.all(...) and take the first row, or a query builder's .get().",
        });
      },
    };
  },
};

export default {
  meta: { name: "deevy" },
  rules: { "no-raw-db-get": noRawDbGet },
};
