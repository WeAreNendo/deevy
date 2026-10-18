/**
 * The release this bundle is, written in by the build from package.json
 * (scripts/build.ts, scripts/local.ts). Undefined in a test that imports the
 * source without building it.
 */
declare const __DEEVY_VERSION__: string | undefined;

export const VERSION = typeof __DEEVY_VERSION__ === "string" ? __DEEVY_VERSION__ : undefined;
