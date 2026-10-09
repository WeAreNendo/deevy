import { readHostedEnv, type HostedBindings, type HostedEnv } from "./env.ts";
import { meter } from "./meter.ts";
import { route } from "./router.ts";

export { Platform } from "./platform.ts";
export { WorkspaceObject } from "./workspace.ts";

/**
 * The many-Workspaces Worker (ADR-0028, docs/plans/hosted.md): one deploy for
 * every hosted Workspace, each one's database and deevy in an object of its
 * own. The platform's configuration is read once per isolate; everything
 * that is a Workspace's own lives in its object.
 */
const read = new WeakMap<HostedBindings, HostedEnv>();

export default {
  async fetch(request: Request, bindings: HostedBindings): Promise<Response> {
    let hosted = read.get(bindings);
    if (!hosted) {
      hosted = readHostedEnv(bindings);
      read.set(bindings, hosted);
    }
    const started = Date.now();
    const response = await route(request, bindings, hosted);
    meter(bindings.ANALYTICS, request, response, Date.now() - started);
    return response;
  },
} satisfies ExportedHandler<HostedBindings>;
