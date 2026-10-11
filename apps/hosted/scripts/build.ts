/**
 * `vp run hosted#build:hosted`: the bundle at dist/hosted/worker.js, with the
 * version it is written in (scripts/local.ts). After `vp run web#build:workers`.
 */
import { buildHosted } from "./local.ts";

await buildHosted();
