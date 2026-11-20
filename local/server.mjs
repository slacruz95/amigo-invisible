import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, networkInterfaces } from "node:os";
import { createDraw } from "../public/draw.mjs";

const port = Number(process.env.AMIGO_LOCAL_PORT || 5001);
const lan = process.argv.includes("--lan");
const dataFile = process.env.AMIGO_LOCAL_DATA || join(tmpdir(), "amigo-invisible-local.json");
const newToken = () => randomBytes(32).toString("hex");
const adminToken = newToken();
const canonical = name => name.normalize("NFC").toLocaleLowerCase("es-UY");
let state = { people: [], audit: null };
try {
  state = JSON.parse(readFileSync(dataFile, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

function save(next) {
  const temporary = dataFile + ".tmp";
  writeFileSync(temporary, JSON.stringify(next), { mode: 0o600 });
  renameSync(temporary, dataFile);
  state = next;
}

function send(res, status, value, type = "application/json; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(type.startsWith("application/json") ? JSON.stringify(value) : value);
}

const assets = new Map([
  ["/", ["./index.html", "text/html; charset=utf-8"]],
  ["/local.mjs", ["./local.mjs", "text/javascript; charset=utf-8"]],
  ["/styles.css", ["../public/styles.css", "text/css; charset=utf-8"]],
]);

async function readJson(req, res) {
  if (req.headers["content-type"] !== "application/json") {
    send(res, 415, { error: "Formato inválido." });
    return;
  }
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 20000) {
      send(res, 413, { error: "La solicitud es demasiado larga." });
      return;
    }
  }
  try { return { value: JSON.parse(body) }; }
  catch { send(res, 400, { error: "No se pudo leer la solicitud." }); }
}

async function request(req, res) {
  const path = new URL(req.url, "http://localhost").pathname;
  const token = req.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/u)?.[1];
  const role = token === adminToken;
  if (req.method === "GET" && assets.has(path)) {
    const [file, type] = assets.get(path);
    return send(res, 200, readFileSync(new URL(file, import.meta.url)), type);
  }
  if (req.method === "POST" && path === "/api/enter") {
    const body = await readJson(req, res);
    if (!body) return;
    const input = body.value;
    const name = typeof input?.name === "string" ? input.name.trim().replace(/\s+/gu, " ") : "";
    if (!name || name.length > 60) return send(res, 400, { error: "Ingresá un nombre de hasta 60 caracteres." });
    const key = canonical(name);
    if (key === "admin1") return send(res, 200, { admin: true, token: adminToken });
    const existing = state.people.find(person => canonical(person.name) === key);
    if (existing) {
      if (existing.token === token) return send(res, 200, { token });
      return send(res, 409, { error: "Ese nombre ya está registrado. Usá tu enlace personal o agregá un apellido." });
    }
    if (state.people.length >= 100) return send(res, 409, { error: "El grupo llegó a 100 participantes." });
    const person = { name, token: newToken(), recipient: null };
    save({ ...state, people: [...state.people, person] });
    return send(res, 201, { token: person.token });
  }
  if (req.method === "GET" && path === "/api/participant") {
    const person = token && state.people.find(item => item.token === token);
    return person
      ? send(res, 200, { name: person.name, recipient: person.recipient, drawn: Boolean(state.audit), round: state.round ?? Number(Boolean(state.audit)) })
      : send(res, 404, { error: "Este enlace personal no es válido." });
  }
  if (req.method === "GET" && path === "/api/admin" && role) {
    return send(res, 200, {
      names: state.people.map(person => person.name),
      selected: state.people.filter(person => person.recipient !== null).map(person => person.name),
      audit: state.audit,
      round: state.round ?? Number(Boolean(state.audit)),
    });
  }
  if (req.method === "POST" && path === "/api/draw" && role) {
    const body = await readJson(req, res);
    if (!body) return;
    const { selected, previousAudit } = body.value ?? {};
    if (previousAudit !== state.audit) return send(res, 409, { error: "Ya hay una ronda nueva. Revisá la selección y volvé a intentar." });
    const registered = new Set(state.people.map(person => person.name));
    if (!Array.isArray(selected) || selected.length < 2 || new Set(selected).size !== selected.length ||
        selected.length > registered.size || !selected.every(name => registered.has(name))) {
      return send(res, 400, { error: "Seleccioná al menos dos personas registradas." });
    }
    const draw = createDraw(selected);
    const assignments = new Map(draw.names.map((name, index) => [name, draw.names[draw.recipients[index]]]));
    const people = state.people.map(person => ({ ...person, recipient: assignments.get(person.name) ?? null }));
    const round = (state.round ?? Number(Boolean(state.audit))) + 1;
    save({ people, audit: newToken(), round });
    return send(res, 200, { audit: state.audit });
  }
  if (req.method === "GET" && path === "/api/audit" && token && token === state.audit) {
    const participants = state.people.filter(person => person.recipient !== null);
    const eligible = new Set(participants.map(person => person.name));
    const assigned = participants.map(person => person.recipient);
    return send(res, 200, {
      count: participants.length,
      round: state.round ?? 1,
      assigned: assigned.filter(Boolean).length,
      unique: new Set(assigned.filter(Boolean)).size,
      allEligible: assigned.every(name => eligible.has(name)),
      nobodySelf: participants.every(person => person.name !== person.recipient),
      pairs: participants.map(person => ({ giver: person.name, recipient: person.recipient })),
    });
  }
  return send(res, 404, { error: "Este enlace no está disponible." });
}

createServer((req, res) => {
  request(req, res).catch(error => {
    console.error(error);
    if (!res.headersSent) send(res, 500, { error: "No se pudo completar la operación." });
    else res.end();
  });
}).listen(port, lan ? "0.0.0.0" : "127.0.0.1", () => {
  console.log(`Amigo invisible local: http://127.0.0.1:${port}`);
  if (lan) {
    for (const addresses of Object.values(networkInterfaces())) {
      for (const address of addresses ?? []) {
        if (address.family === "IPv4" && !address.internal) console.log(`Red local: http://${address.address}:${port}`);
      }
    }
  }
});
