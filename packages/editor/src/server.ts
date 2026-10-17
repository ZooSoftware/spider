// `spider dev` server: serves the editor app (bundled by Bun from index.html) and owns all file
// IO — reading/writing the .spd and its layout sidecar, loading profiles, and pushing external
// file changes to the browser over SSE. Parsing, layout and rendering run in the browser.
import { existsSync, watch } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import type { UseDecl } from "@spider/core";
import { loadProfiles } from "@spider/profiles";
import index from "./index.html";

export interface DevServerOptions {
  file: string;
  port?: number;
}

export interface DevServer {
  url: string;
  stop(): void;
}

type Push = (event: string, data: unknown) => void;

export async function startDevServer(opts: DevServerOptions): Promise<DevServer> {
  const file = resolve(opts.file);
  const layoutPath = `${file}.layout.json`;
  const dir = dirname(file);
  if (!existsSync(file)) await writeFile(file, "use base/architecture\n\n");

  // Last content known on disk, so our own writes don't echo back as "external" changes.
  const known = {
    text: await readFile(file, "utf8"),
    layout: existsSync(layoutPath) ? await readFile(layoutPath, "utf8") : "",
  };
  const clients = new Set<Push>();
  const broadcast: Push = (event, data) => {
    for (const push of clients) push(event, data);
  };

  const watcher = watch(dir, async (_ev, name) => {
    if (name !== basename(file) && name !== basename(layoutPath)) return;
    const isText = name === basename(file);
    const path = isText ? file : layoutPath;
    const content = existsSync(path) ? await readFile(path, "utf8") : "";
    if (isText ? content === known.text : content === known.layout) return;
    if (isText) known.text = content;
    else known.layout = content;
    broadcast(isText ? "text" : "layout", isText ? { text: content } : { layout: content });
  });

  const server = Bun.serve({
    port: opts.port ?? 4321,
    hostname: "127.0.0.1",
    development: { hmr: false, console: false },
    routes: {
      "/": index,
      "/api/doc": {
        GET: () => Response.json({ path: file, name: basename(file), text: known.text, layout: known.layout || null }),
      },
      "/api/text": {
        PUT: async (req) => {
          const text = await req.text();
          if (text !== known.text) {
            known.text = text;
            await writeFile(file, text);
          }
          return new Response(null, { status: 204 });
        },
      },
      "/api/layout": {
        PUT: async (req) => {
          const layout = await req.text();
          if (layout !== known.layout) {
            known.layout = layout;
            await writeFile(layoutPath, layout);
          }
          return new Response(null, { status: 204 });
        },
      },
      "/api/profile": {
        POST: async (req) => {
          const uses = (await req.json()) as UseDecl[];
          const result = await loadProfiles(uses, { searchPaths: [dir, resolve(dir, "profiles"), resolve("profiles")] });
          return Response.json(result);
        },
      },
      "/api/events": {
        GET: (req, srv) => {
          // SSE connections are long-lived: disable Bun's idle timeout and keep proxies happy.
          srv.timeout(req, 0);
          let push: Push | undefined;
          let ping: ReturnType<typeof setInterval> | undefined;
          const stream = new ReadableStream<string>({
            start(controller) {
              push = (event, data) => controller.enqueue(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
              clients.add(push);
              controller.enqueue(": connected\n\n");
              ping = setInterval(() => controller.enqueue(": ping\n\n"), 15000);
              req.signal.addEventListener("abort", () => {
                clearInterval(ping);
                if (push) clients.delete(push);
                controller.close();
              });
            },
          });
          return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
        },
      },
    },
  });

  return {
    url: server.url.href,
    stop() {
      watcher.close();
      server.stop(true);
    },
  };
}
