/**
 * FasTask Agent API
 * Puerta con llave para que un asistente (Muse u otro) lea y escriba tareas.
 *
 * Secretos (wrangler secret put):
 *   AGENT_API_KEY         llave que usa el asistente (Authorization: Bearer ...)
 *   FIREBASE_PROJECT_ID   id del proyecto de Firebase
 *   FIREBASE_CLIENT_EMAIL client_email de la cuenta de servicio
 *   FIREBASE_PRIVATE_KEY  private_key de la cuenta de servicio
 * Variable opcional:
 *   WRITE_ENABLED         "0" desactiva toda escritura (solo lectura). Por defecto "1".
 *
 * Rutas:
 *   GET   /summary                          resumen: vencidas, proximas, estancadas
 *   GET   /tasks?status=&category=&due_before=YYYY-MM-DD&include_done=1
 *   POST  /tasks                            crea tarea
 *   PATCH /tasks/:id                        cambia status, deadline, priority, category, context, title
 *   POST  /tasks/:id/done                   marca como hecha
 * No hay ruta para borrar, a proposito.
 */

const COLLECTION = "voztasks";
const CATEGORIES = ["freelance", "trabajo", "estudio", "personal"];
const PRIORITIES = ["baja", "media", "alta"];
const STATUSES = ["todo", "inprogress", "waiting", "done", "archived"];
const PATCHABLE = { title: "str", context: "str", deadline: "date", priority: PRIORITIES, category: CATEGORIES, status: STATUSES };
const MAX_TITLE = 200, MAX_CONTEXT = 1000, MAX_BODY = 8000, STALE_DAYS = 7;

export default {
  async fetch(request, env) {
    try {
      if (request.method === "OPTIONS") return new Response(null, { status: 204 });
      if (!(await authorized(request, env))) return json({ ok: false, error: "no autorizado" }, 401);

      const url = new URL(request.url);
      const parts = url.pathname.replace(/^\/+|\/+$/g, "").split("/");
      const method = request.method;

      if (method === "GET" && parts[0] === "summary") return json(await summary(env));
      if (method === "GET" && parts[0] === "tasks" && parts.length === 1) return json(await listTasks(env, url.searchParams));

      const writes = method === "POST" || method === "PATCH";
      if (writes && env.WRITE_ENABLED === "0") return json({ ok: false, error: "escritura desactivada" }, 403);

      if (method === "POST" && parts[0] === "tasks" && parts.length === 1) return json(await createTask(env, await readBody(request)), 201);
      if (method === "POST" && parts[0] === "tasks" && parts[2] === "done") return json(await patchTask(env, parts[1], { status: "done" }));
      if (method === "PATCH" && parts[0] === "tasks" && parts.length === 2) return json(await patchTask(env, parts[1], await readBody(request)));

      return json({ ok: false, error: "ruta no encontrada" }, 404);
    } catch (e) {
      if (e instanceof HttpError) return json({ ok: false, error: e.message }, e.status);
      console.error(e);
      return json({ ok: false, error: "error interno" }, 500);
    }
  },
};

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

async function readBody(request) {
  const text = await request.text();
  if (text.length > MAX_BODY) throw new HttpError(413, "cuerpo demasiado grande");
  try { return JSON.parse(text || "{}"); } catch { throw new HttpError(400, "JSON invalido"); }
}

/* ---------- Autenticacion (comparacion en tiempo constante) ---------- */
async function authorized(request, env) {
  const header = request.headers.get("Authorization") || "";
  const given = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!given || !env.AGENT_API_KEY) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(given)),
    crypto.subtle.digest("SHA-256", enc.encode(env.AGENT_API_KEY)),
  ]);
  const x = new Uint8Array(a), y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

/* ---------- Logica de tareas ---------- */
const isDate = v => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const todayStr = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });

function publicTask(t) {
  return {
    id: t.id, title: t.title, status: t.status || "todo", priority: t.priority || "baja",
    category: t.category || null, deadline: t.deadline || null, context: t.context || null,
    link: t.link || null, created: t.createdAt || null, source: t.source || null,
  };
}

async function allTasks(env) {
  const docs = [];
  let pageToken = "";
  for (let i = 0; i < 10; i++) {
    const q = `pageSize=300${pageToken ? "&pageToken=" + encodeURIComponent(pageToken) : ""}`;
    const res = await fs(env, "GET", `/${COLLECTION}?${q}`);
    (res.documents || []).forEach(d => docs.push(fromDoc(d)));
    if (!res.nextPageToken) break;
    pageToken = res.nextPageToken;
  }
  return docs;
}

async function listTasks(env, p) {
  const status = p.get("status"), category = p.get("category"), dueBefore = p.get("due_before");
  const includeDone = p.get("include_done") === "1";
  if (status && !STATUSES.includes(status)) throw new HttpError(400, "status invalido");
  if (category && !CATEGORIES.includes(category)) throw new HttpError(400, "category invalida");
  if (dueBefore && !isDate(dueBefore)) throw new HttpError(400, "due_before debe ser AAAA-MM-DD");

  let list = await allTasks(env);
  if (status) list = list.filter(t => t.status === status);
  else if (!includeDone) list = list.filter(t => t.status !== "done" && t.status !== "archived");
  if (category) list = list.filter(t => t.category === category);
  if (dueBefore) list = list.filter(t => t.deadline && t.deadline <= dueBefore);
  list.sort((a, b) => (a.deadline || "9999").localeCompare(b.deadline || "9999"));
  return { ok: true, today: todayStr(), count: list.length, tasks: list.map(publicTask) };
}

async function summary(env) {
  const today = todayStr();
  const soon = new Date(Date.now() + 3 * 864e5).toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });
  const open = (await allTasks(env)).filter(t => t.status !== "done" && t.status !== "archived");
  const withDl = open.filter(t => t.deadline);
  const staleCut = new Date(Date.now() - STALE_DAYS * 864e5).toISOString();
  return {
    ok: true, today,
    open: open.length,
    overdue: withDl.filter(t => t.deadline < today).map(publicTask),
    due_today: withDl.filter(t => t.deadline === today).map(publicTask),
    due_soon: withDl.filter(t => t.deadline > today && t.deadline <= soon).map(publicTask),
    no_deadline: open.filter(t => !t.deadline).length,
    stalled: open.filter(t => t.status === "inprogress" && (t.createdAt || "") < staleCut).map(publicTask),
  };
}

function cleanText(v, max, name) {
  if (typeof v !== "string") throw new HttpError(400, `${name} debe ser texto`);
  const s = v.trim();
  if (!s || s.length > max) throw new HttpError(400, `${name} vacio o mayor a ${max} caracteres`);
  return s;
}

async function createTask(env, b) {
  const title = cleanText(b.title, MAX_TITLE, "title");
  const category = b.category ?? "trabajo";
  const priority = b.priority ?? "baja";
  if (!CATEGORIES.includes(category)) throw new HttpError(400, "category invalida");
  if (!PRIORITIES.includes(priority)) throw new HttpError(400, "priority invalida");
  if (b.deadline != null && !isDate(b.deadline)) throw new HttpError(400, "deadline debe ser AAAA-MM-DD");
  const context = b.context != null ? cleanText(b.context, MAX_CONTEXT, "context") : null;
  const link = b.link != null && /^https?:\/\//.test(String(b.link)) ? String(b.link).slice(0, 500) : null;

  // Evita duplicados: misma tarea abierta con el mismo titulo y fecha.
  const dup = (await allTasks(env)).find(t =>
    t.status !== "done" && t.status !== "archived" &&
    (t.title || "").trim().toLowerCase() === title.toLowerCase() && (t.deadline || null) === (b.deadline || null));
  if (dup) return { ok: true, duplicate: true, task: publicTask(dup) };

  const data = {
    title, time: null, priority, category, context, link, document: null,
    deadline: b.deadline || null, status: "todo", done: false,
    createdAt: new Date().toISOString(), source: "agente",
  };
  const doc = await fs(env, "POST", `/${COLLECTION}`, { fields: toFields(data) });
  return { ok: true, task: publicTask(fromDoc(doc)) };
}

async function patchTask(env, id, b) {
  if (!/^[A-Za-z0-9]{10,40}$/.test(id || "")) throw new HttpError(400, "id invalido");
  const data = {};
  for (const [k, rule] of Object.entries(PATCHABLE)) {
    if (!(k in b)) continue;
    const v = b[k];
    if (rule === "str") data[k] = cleanText(v, k === "title" ? MAX_TITLE : MAX_CONTEXT, k);
    else if (rule === "date") { if (v !== null && !isDate(v)) throw new HttpError(400, "deadline debe ser AAAA-MM-DD"); data[k] = v; }
    else { if (!rule.includes(v)) throw new HttpError(400, `${k} invalido`); data[k] = v; }
  }
  if (!Object.keys(data).length) throw new HttpError(400, "nada que actualizar");
  if (data.status) data.done = data.status === "done";

  const mask = Object.keys(data).map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join("&");
  // currentDocument.exists evita crear un documento nuevo si el id no existe.
  const doc = await fs(env, "PATCH", `/${COLLECTION}/${id}?${mask}&currentDocument.exists=true`, { fields: toFields(data) });
  return { ok: true, task: publicTask(fromDoc(doc)) };
}

/* ---------- Firestore REST ---------- */
function toFields(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) out[k] = { nullValue: null };
    else if (typeof v === "boolean") out[k] = { booleanValue: v };
    else if (typeof v === "number") out[k] = Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    else out[k] = { stringValue: String(v) };
  }
  return out;
}

function fromDoc(d) {
  const o = { id: d.name.split("/").pop() };
  for (const [k, v] of Object.entries(d.fields || {})) {
    if ("stringValue" in v) o[k] = v.stringValue;
    else if ("booleanValue" in v) o[k] = v.booleanValue;
    else if ("integerValue" in v) o[k] = Number(v.integerValue);
    else if ("doubleValue" in v) o[k] = v.doubleValue;
    else if ("timestampValue" in v) o[k] = v.timestampValue;
    else if ("nullValue" in v) o[k] = null;
  }
  return o;
}

async function fs(env, method, path, body) {
  const token = await accessToken(env);
  const base = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
  const res = await fetch(base + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 404) throw new HttpError(404, "tarea no encontrada");
  if (!res.ok) {
    console.error("firestore", res.status, await res.text());
    throw new HttpError(502, "error al hablar con la base de datos");
  }
  return res.json();
}

/* Token de la cuenta de servicio: JWT firmado con RS256, se reutiliza hasta que expira. */
let cached = { token: "", exp: 0 };

async function accessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  if (cached.token && cached.exp - 60 > now) return cached.token;

  const b64 = s => btoa(String.fromCharCode(...new Uint8Array(typeof s === "string" ? new TextEncoder().encode(s) : s)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const header = b64(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64(JSON.stringify({
    iss: env.FIREBASE_CLIENT_EMAIL, scope: "https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
  }));
  const pem = env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
    .replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${claims}`));
  const jwt = `${header}.${claims}.${b64(sig)}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  if (!res.ok) { console.error("token", res.status, await res.text()); throw new HttpError(502, "no pude autenticar con la base de datos"); }
  const data = await res.json();
  cached = { token: data.access_token, exp: now + (data.expires_in || 3600) };
  return cached.token;
}
