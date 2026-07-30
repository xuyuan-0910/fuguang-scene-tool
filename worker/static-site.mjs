const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

function publicMap(object, requestUrl) {
  const id = object.key.slice("maps/".length);
  const metadata = object.customMetadata || {};
  const base = new URL(requestUrl);
  return {
    id,
    name: decodeURIComponent(metadata.name || "共享场景"),
    width: Number(metadata.width) || 0,
    height: Number(metadata.height) || 0,
    createdAt: Number(metadata.createdAt) || Date.now(),
    src: `${base.origin}/api/maps/${encodeURIComponent(id)}`,
    shared: true,
  };
}

async function handleMaps(request, env, url) {
  const bucket = env.SCENES;
  if (!bucket) return json({ error: "共享场景存储尚未启用" }, 503);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  if (url.pathname === "/api/maps" && request.method === "GET") {
    const result = await bucket.list({ prefix: "maps/", limit: 1000 });
    const maps = result.objects.map((item) => publicMap(item, request.url)).sort((a, b) => b.createdAt - a.createdAt);
    return json({ maps });
  }

  if (url.pathname === "/api/maps" && request.method === "POST") {
    const contentLength = Number(request.headers.get("content-length")) || 0;
    if (contentLength > 100 * 1024 * 1024) return json({ error: "图片不能超过 100MB" }, 413);
    const form = await request.formData();
    const file = form.get("file");
    if (!file || typeof file.arrayBuffer !== "function") return json({ error: "请选择图片" }, 400);
    if (!/^image\/(png|jpeg|webp|gif)$/i.test(file.type)) return json({ error: "仅支持 PNG、JPG、WEBP 或 GIF" }, 415);
    const bytes = await file.arrayBuffer();
    if (bytes.byteLength > 100 * 1024 * 1024) return json({ error: "图片不能超过 100MB" }, 413);
    const id = crypto.randomUUID();
    const name = String(form.get("name") || file.name || "共享场景").slice(0, 80);
    const metadata = {
      name: encodeURIComponent(name),
      width: String(Number(form.get("width")) || 0),
      height: String(Number(form.get("height")) || 0),
      createdAt: String(Date.now()),
    };
    await bucket.put(`maps/${id}`, bytes, { httpMetadata: { contentType: file.type }, customMetadata: metadata });
    return json(publicMap({ key: `maps/${id}`, customMetadata: metadata }, request.url), 201);
  }

  const match = url.pathname.match(/^\/api\/maps\/([^/]+)$/);
  if (!match) return json({ error: "Not found" }, 404);
  const id = decodeURIComponent(match[1]);
  if (!/^[a-zA-Z0-9-]+$/.test(id)) return json({ error: "无效场景" }, 400);
  const key = `maps/${id}`;

  if (request.method === "GET") {
    const object = await bucket.get(key);
    if (!object) return json({ error: "场景不存在" }, 404);
    const headers = new Headers(corsHeaders);
    object.writeHttpMetadata(headers);
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
    headers.set("ETag", object.httpEtag);
    return new Response(object.body, { headers });
  }

  if (request.method === "DELETE") {
    await bucket.delete(key);
    return json({ ok: true });
  }

  return json({ error: "Method not allowed" }, 405);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/maps")) return handleMaps(request, env, url);
    if (url.pathname === "/") url.pathname = "/index.html";
    if (env?.ASSETS?.fetch) return env.ASSETS.fetch(new Request(url, request));
    return new Response("Static asset binding unavailable", { status: 503 });
  },
};
