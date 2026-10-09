/**
 * A stand-in for the private console, for the smoke only (scripts/smoke-hosted.ts).
 *
 * The hosted Worker hands the root of its host and the console's paths to a
 * `CONSOLE` service binding, and the console reaches the hosted Worker's
 * `Platform` entrypoint over another — exactly the shape the real one has.
 * Here `POST /console/platform/<method>` with a JSON array of arguments calls
 * that method and answers with its result, so the smoke can provision and
 * remove Workspaces the way the console does, through RPC and nothing else.
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const call = /^\/console\/platform\/([a-z]+)$/.exec(url.pathname);
    if (call && request.method === "POST") {
      const args = await request.json();
      try {
        const result = await env.PLATFORM[call[1]](...args);
        return Response.json({ result: result ?? null });
      } catch (error) {
        return Response.json({ error: String(error?.message ?? error) }, { status: 400 });
      }
    }
    return new Response("the console", { headers: { "content-type": "text/plain" } });
  },
};
