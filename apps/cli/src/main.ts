/**
 * The CLI's entry. Slice 0 carries only the walk, so this reports what it found
 * and exits; the commands themselves arrive in slice 3.
 */
import { router } from "@deevy/core/router";
import { commandsFor } from "./commands.ts";

const commands = commandsFor(router);
console.log(`deevy: ${String(commands.length)} operations`);
