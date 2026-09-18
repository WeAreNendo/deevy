import { OpenAPIGenerator } from "@orpc/openapi";
import { ZodToJsonSchemaConverter } from "@orpc/zod";
import { router } from "./operations/index.ts";

const generator = new OpenAPIGenerator({ converters: [new ZodToJsonSchemaConverter()] });

/** The OpenAPI 3.1 document for the HTTP surface, served at /api/spec.json and snapshotted in CI (ADR-0009). */
export function generateSpec(version?: string) {
  return generator.generate(router, {
    base: {
      // The instance's own version when an entry knows it, so one fetch of this
      // document answers both questions a client has: what this deevy can do,
      // and which deevy it is. The committed snapshot is generated without one,
      // so it stays stable (ADR-0009).
      info: { title: "deevy", version: version ?? "0.0.0" },
      servers: [{ url: "/api" }],
    },
  });
}
