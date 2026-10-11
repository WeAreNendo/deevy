import { docsLoader } from "@astrojs/starlight/loaders";
import { docsSchema } from "@astrojs/starlight/schema";
import { defineCollection } from "astro:content";

// Starlight's own collection, read from src/content/docs: what scripts/sync.ts writes there.
export const collections = {
  docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),
};
