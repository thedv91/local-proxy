import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { BunRequest, HTMLBundle } from "bun";
import { type LocalProxy, ValidationError } from "../local-proxy";
import { RecordNotFoundError } from "../records/store";

/**
 * The admin UI: Bun's HTML import when running from the repo (bundled on the
 * fly, with HMR in dev), or the directory scripts/build.ts wrote, for the
 * published package.
 */
export type AdminUi = HTMLBundle | { builtDir: string };

/** Admin UI and JSON API on 127.0.0.1 only. */
export function startAdminServer(localProxy: LocalProxy, port: number, ui: AdminUi) {
  return Bun.serve({
    hostname: "127.0.0.1",
    port,
    development: process.env.NODE_ENV !== "production" && { hmr: true, console: true },
    routes: {
      ...uiRoutes(ui),
      "/api/records": {
        GET: () => Response.json(localProxy.listRecords()),
        POST: (request) =>
          handle(async () => {
            const record = await localProxy.addRecord(await readJson(request));
            return Response.json(record, { status: 201 });
          }),
      },
      "/api/records/:id": {
        PUT: (request: BunRequest<"/api/records/:id">) =>
          handle(async () =>
            Response.json(
              await localProxy.updateRecord(request.params.id, await readJson(request)),
            ),
          ),
        DELETE: (request: BunRequest<"/api/records/:id">) =>
          handle(async () => {
            await localProxy.removeRecord(request.params.id);
            return new Response(null, { status: 204 });
          }),
      },
      "/api/status": {
        GET: async () => Response.json(await localProxy.portlessStatus()),
      },
      "/api/log": {
        GET: (request) => {
          const after = Number(new URL(request.url).searchParams.get("after") ?? 0);
          return Response.json(localProxy.requestLog.since(after));
        },
      },
    },
  });
}

function uiRoutes(ui: AdminUi): Record<string, HTMLBundle | Response> {
  if (!("builtDir" in ui)) {
    return { "/": ui };
  }
  const routes: Record<string, Response> = {};
  for (const file of readdirSync(ui.builtDir)) {
    routes[file === "index.html" ? "/" : `/${file}`] = new Response(
      Bun.file(join(ui.builtDir, file)),
    );
  }
  return routes;
}

/**
 * Requiring a JSON content type makes a cross-site form or no-cors fetch
 * trigger a CORS preflight, which this server never answers, so other pages
 * in the browser cannot change records.
 */
async function readJson(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    throw new ValidationError("", "Expected Content-Type: application/json");
  }
  return request.json().catch(() => {
    throw new ValidationError("", "Request body is not valid JSON");
  });
}

async function handle(action: () => Promise<Response>): Promise<Response> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof ValidationError) {
      return Response.json({ error: error.message, field: error.field }, { status: 400 });
    }
    if (error instanceof RecordNotFoundError) {
      return Response.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}
