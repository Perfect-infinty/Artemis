// Minimal MCP (Model Context Protocol) client: stdio and Streamable HTTP transports. Tools only.
const { spawn } = require("child_process");
const os = require("os");
const path = require("path");

const PROTOCOL = "2025-03-26";
const slug = (s) =>
  String(s || "server")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24) || "server";
const abortErr = () =>
  Object.assign(new Error("Aborted"), { name: "AbortError" });

/** GUI apps on macOS start with a tiny PATH; add the usual tool locations (npx, uvx, brew, nvm...). */
function richPath(envPath) {
  const extra = [
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/local/bin",
    "/usr/local/sbin",
    path.join(os.homedir(), ".local/bin"),
    path.join(os.homedir(), ".cargo/bin"),
    "/usr/bin",
    "/bin",
  ];
  return [
    ...new Set([
      ...(envPath || "").split(path.delimiter).filter(Boolean),
      ...extra,
    ]),
  ].join(path.delimiter);
}

class Rpc {
  constructor() {
    this.id = 0;
    this.pending = new Map();
  }
  request(send, method, params, { signal, timeout = 30000 } = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request "${method}" timed out`));
      }, timeout);
      const done = (fn, v) => {
        clearTimeout(t);
        this.pending.delete(id);
        signal?.removeEventListener("abort", onAbort);
        fn(v);
      };
      const onAbort = () => {
        done(reject, abortErr());
      };
      if (signal?.aborted) return done(reject, abortErr());
      signal?.addEventListener("abort", onAbort, { once: true });
      this.pending.set(id, {
        resolve: (v) => done(resolve, v),
        reject: (e) => done(reject, e),
      });
      Promise.resolve(send({ jsonrpc: "2.0", id, method, params })).catch((e) =>
        done(reject, e),
      );
    });
  }
  handle(msg) {
    if (msg && msg.id !== undefined && !msg.method) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      if (msg.error) p.reject(new Error(msg.error.message || "MCP error"));
      else p.resolve(msg.result);
      return true;
    }
    return false;
  }
  failAll(err) {
    for (const p of [...this.pending.values()]) p.reject(err);
  }
}

function stdioTransport(cfg, onMessage, onClose) {
  const env = { ...process.env, ...(cfg.env || {}) };
  env.PATH = richPath(env.PATH);
  const child = spawn(cfg.command, cfg.args || [], {
    env,
    stdio: ["pipe", "pipe", "pipe"],
    shell: process.platform === "win32",
    windowsHide: true,
  });
  let buf = "",
    stderr = "";
  child.stdout.on("data", (d) => {
    buf += d.toString("utf8");
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      try {
        onMessage(JSON.parse(line));
      } catch {}
    }
  });
  child.stderr.on("data", (d) => {
    stderr = (stderr + d.toString("utf8")).slice(-2000);
  });
  child.on("error", (e) =>
    onClose(
      e.code === "ENOENT"
        ? new Error(
            `Command not found: ${cfg.command}. Install it or use its full path.`,
          )
        : e,
    ),
  );
  child.on("close", (code) =>
    onClose(
      new Error(
        `Server exited (code ${code}).${stderr ? " " + stderr.trim().split("\n").slice(-2).join(" ") : ""}`,
      ),
    ),
  );
  return {
    send: (msg) =>
      new Promise((resolve, reject) =>
        child.stdin.write(JSON.stringify(msg) + "\n", (e) =>
          e ? reject(e) : resolve(),
        ),
      ),
    close: () => {
      try {
        child.stdin.end();
        child.kill();
      } catch {}
    },
  };
}

function httpTransport(cfg, onMessage) {
  let sessionId = null,
    protocol = PROTOCOL;
  const headers = () => ({
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "mcp-protocol-version": protocol,
    ...(sessionId ? { "mcp-session-id": sessionId } : {}),
    ...(cfg.headers || {}),
    ...(cfg.oauth?.accessToken
      ? { authorization: `Bearer ${cfg.oauth.accessToken}` }
      : {}),
  });
  async function readSse(res) {
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.search(/\r?\n\r?\n/)) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i).replace(/^\r?\n\r?\n/, "");
        const data = block
          .split(/\r?\n/)
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trim())
          .join("\n");
        if (data) {
          try {
            onMessage(JSON.parse(data));
          } catch {}
        }
      }
    }
  }
  return {
    setProtocol: (v) => {
      protocol = v || protocol;
    },
    async send(msg) {
      const res = await fetch(cfg.url, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(msg),
      });
      const sid = res.headers.get("mcp-session-id");
      if (sid) sessionId = sid;
      if (res.status === 202 || res.status === 204) return;
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}${t ? ": " + t.slice(0, 200) : ""}`);
      }
      const type = res.headers.get("content-type") || "";
      if (type.includes("text/event-stream")) await readSse(res);
      else {
        const text = await res.text();
        if (text.trim()) {
          const j = JSON.parse(text);
          (Array.isArray(j) ? j : [j]).forEach(onMessage);
        }
      }
    },
    close: () => {
      if (sessionId)
        fetch(cfg.url, { method: "DELETE", headers: headers() }).catch(
          () => {},
        );
    },
  };
}

class McpServer {
  constructor(cfg) {
    this.cfg = cfg;
    this.slug = slug(cfg.name);
    this.state = "idle";
    this.error = "";
    this.tools = [];
    this.rpc = new Rpc();
    this.transport = null;
  }
  async connect() {
    this.state = "connecting";
    this.error = "";
    try {
      const onMessage = (msg) => {
        if (this.rpc.handle(msg)) return;
        if (msg.method === "ping" && msg.id !== undefined)
          this.transport
            ?.send({ jsonrpc: "2.0", id: msg.id, result: {} })
            .catch(() => {});
        else if (msg.method === "notifications/tools/list_changed")
          this.refresh().catch(() => {});
        else if (msg.id !== undefined && msg.method)
          this.transport
            ?.send({
              jsonrpc: "2.0",
              id: msg.id,
              error: { code: -32601, message: "Not supported" },
            })
            .catch(() => {});
      };
      const onClose = (err) => {
        if (this.state !== "closed" && !this.error) {
          this.state = "error";
          this.error = err.message;
        }
        this.rpc.failAll(err);
      };
      if (this.cfg.type === "http")
        this.transport = httpTransport(this.cfg, onMessage);
      else {
        if (!this.cfg.command) throw new Error("Command is required");
        this.transport = stdioTransport(this.cfg, onMessage, onClose);
      }
      const send = (m) => this.transport.send(m);
      const init = await this.rpc.request(
        send,
        "initialize",
        {
          protocolVersion: PROTOCOL,
          capabilities: {},
          clientInfo: { name: "zero", version: "1.0.0" },
        },
        { timeout: 60000 },
      );
      this.transport.setProtocol?.(init?.protocolVersion);
      this.serverInfo = init?.serverInfo || {};
      await send({ jsonrpc: "2.0", method: "notifications/initialized" });
      await this.refresh();
      this.state = "connected";
    } catch (e) {
      this.state = "error";
      this.error = this.error || e.message;
      this.close(true);
    }
  }
  async refresh() {
    const tools = [];
    let cursor;
    do {
      const r = await this.rpc.request(
        (m) => this.transport.send(m),
        "tools/list",
        cursor ? { cursor } : {},
        { timeout: 30000 },
      );
      tools.push(...(r?.tools || []));
      cursor = r?.nextCursor;
    } while (cursor && tools.length < 500);
    this.tools = tools;
  }
  async call(name, args, signal) {
    const r = await this.rpc.request(
      (m) => this.transport.send(m),
      "tools/call",
      { name, arguments: args || {} },
      { signal, timeout: 180000 },
    );
    return r;
  }
  close(keepState) {
    if (!keepState) this.state = "closed";
    try {
      this.transport?.close();
    } catch {}
    this.transport = null;
    this.rpc.failAll(new Error("Closed"));
  }
}

const IMAGE_MAX = 4 * 1024 * 1024;

function formatResult(r) {
  const out = [];
  let image = null;
  for (const c of r?.content || []) {
    if (c.type === "text") out.push(c.text);
    else if (c.type === "image" && c.data && c.data.length < IMAGE_MAX) {
      image = `data:${c.mimeType || "image/png"};base64,${c.data}`;
      out.push("[image returned]");
    } else if (c.type === "resource")
      out.push(
        c.resource?.text
          ? c.resource.text
          : `[resource ${c.resource?.uri || ""}]`,
      );
    else out.push(`[${c.type}]`);
  }
  if (!out.length && r?.structuredContent)
    out.push(JSON.stringify(r.structuredContent));
  return { ok: !r?.isError, text: out.join("\n") || "(no output)", image };
}

/** Manager: connects configured servers and exposes their tools as OpenAI function definitions. */
function createMcpManager() {
  let servers = [];

  const uniqueSlugs = () => {
    const seen = {};
    for (const s of servers) {
      let b = s.slug,
        n = 1;
      while (seen[s.slug]) s.slug = `${b}_${++n}`;
      seen[s.slug] = true;
    }
  };

  async function configure(list) {
    for (const s of servers) s.close();
    servers = (list || [])
      .filter((c) => c.enabled !== false)
      .map((c) => new McpServer(c));
    uniqueSlugs();
    await Promise.all(servers.map((s) => s.connect()));
  }
  const status = (list) => {
    const byId = new Map(servers.map((s) => [s.cfg.id, s]));
    return (list || servers.map((s) => s.cfg)).map((c) => {
      const s = byId.get(c.id);
      return {
        id: c.id,
        name: c.name,
        enabled: c.enabled !== false,
        state: s ? s.state : "off",
        error: s ? s.error : "",
        tools: s ? s.tools.map((t) => t.name) : [],
        toolInfo: s ? s.tools.map((t) => ({ name: t.name, description: String(t.description || '').replace(/\s+/g, ' ').trim().slice(0, 300), readOnly: !!(t.annotations && t.annotations.readOnlyHint) })) : [],
      };
    });
  };
  const defName = (s, t) => `mcp__${s.slug}__${t.name}`.slice(0, 64);

  /** Tool definitions of the connected servers; `slugs` (optional) limits them to those servers. */
  function definitions(slugs) {
    const defs = [];
    for (const s of servers) {
      if (s.state !== "connected") continue;
      if (Array.isArray(slugs) && !slugs.includes(s.slug)) continue;
      for (const t of s.tools) {
        defs.push({
          type: "function",
          function: {
            name: defName(s, t),
            description:
              `[${s.cfg.name}] ${t.description || t.title || t.name}`.slice(
                0,
                1000,
              ),
            parameters:
              t.inputSchema && t.inputSchema.type
                ? t.inputSchema
                : { type: "object", properties: {} },
          },
        });
      }
    }
    return defs;
  }
  /** Connected servers in short form, for the on-demand connector list. */
  const index = () => servers.filter((s) => s.state === "connected" && s.tools.length).map((s) => ({ slug: s.slug, name: s.cfg.name, tools: s.tools.map((t) => t.name) }));
  /** Resolves a name the model gave (slug or display name, any case) to a connected server's slug. */
  const resolveSlug = (q) => {
    const k = String(q || "").trim().toLowerCase();
    const hit = index().find((x) => x.slug.toLowerCase() === k || String(x.name).toLowerCase() === k) || index().find((x) => x.slug.toLowerCase().includes(k) || String(x.name).toLowerCase().includes(k));
    return k && hit ? hit.slug : "";
  };
  function find(fullName) {
    for (const s of servers)
      for (const t of s.tools)
        if (defName(s, t) === fullName) return { server: s, tool: t };
    // Models sometimes garble the server part (arteris for artemis). A server slug never contains "__", so the tool part is what follows the
    // first "__": accept it when exactly one connected tool carries that name.
    const rest = String(fullName || '').replace(/^mcp__/, '');
    const i = rest.indexOf('__');
    if (i > 0) {
      const toolPart = rest.slice(i + 2);
      const hits = [];
      for (const s of servers) if (s.state === "connected") for (const t of s.tools) if (t.name === toolPart) hits.push({ server: s, tool: t });
      if (hits.length === 1) return hits[0];
    }
    return null;
  }
  /** Why a connector tool could not be found, written for the model so it can recover. */
  function explainMissing(fullName) {
    const live = servers.map((s) => `${s.slug} (${s.state === "connected" ? `connected, ${s.tools.length} tools` : s.state + (s.error ? `: ${String(s.error).slice(0, 80)}` : "")})`);
    return `Connector tool is not available: ${fullName}. ` + (live.length ? `Connectors: ${live.join("; ")}. ` : "No connectors are connected. ") +
      "Use only the exact tool names you were given; file, web, notes and memory work through the built-in tools, not connectors.";
  }
  const info = (fullName) => {
    const f = find(fullName);
    return f
      ? {
          server: f.server.slug,
          serverName: f.server.cfg.name,
          readOnly: !!f.tool.annotations?.readOnlyHint,
        }
      : null;
  };
  async function call(fullName, args, signal) {
    const f = find(fullName);
    if (!f) throw new Error(`Connector tool not found: ${fullName}`);
    return formatResult(await f.server.call(f.tool.name, args, signal));
  }
  return {
    configure,
    status,
    definitions,
    index,
    resolveSlug,
    info,
    call,
    explainMissing,
    close: () => {
      for (const s of servers) s.close();
      servers = [];
    },
    count: () => servers.filter((s) => s.state === "connected").length,
  };
}

/** Accepts Claude Desktop's { mcpServers: { name: { command, args, env } | { url, headers } } } or a plain array. */
function parseImport(text) {
  const j = JSON.parse(text);
  const src = j.mcpServers || j.servers || j;
  const out = [];
  const add = (name, v) => {
    if (!v || typeof v !== "object") return;
    const id = Math.random().toString(36).slice(2, 10);
    if (v.url)
      out.push({
        id,
        name,
        type: "http",
        url: v.url,
        headers: v.headers || {},
        enabled: true,
      });
    else if (v.command)
      out.push({
        id,
        name,
        type: "stdio",
        command: v.command,
        args: v.args || [],
        env: v.env || {},
        enabled: true,
      });
  };
  if (Array.isArray(src))
    src.forEach((v, i) => add(v.name || `server ${i + 1}`, v));
  else Object.entries(src).forEach(([n, v]) => add(n, v));
  if (!out.length) throw new Error("No servers found in this JSON.");
  return out;
}

module.exports = {
  createMcpManager,
  parseImport,
  formatResult,
  richPath,
  slug,
};
