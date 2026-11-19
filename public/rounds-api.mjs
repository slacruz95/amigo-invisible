import { createDraw } from "./draw.mjs";

const sdk = "https://www.gstatic.com/firebasejs/11.10.0";
let connection;
function connect() {
  connection ??= Promise.all([
    import(sdk + "/firebase-app.js"), import(sdk + "/firebase-auth.js"),
    import(sdk + "/firebase-database.js"), fetch("/__/firebase/init.json"),
  ]).then(async ([app, auth, database, response]) => {
    if (!response.ok) throw new Error("No pudimos conectar con Firebase.");
    const config = await response.json();
    const instance = app.initializeApp(config);
    return { ...auth, ...database, auth: auth.getAuth(instance), db: database.getDatabase(instance,
      config.databaseURL ?? "https://amigo-invisible-b52dd-default-rtdb.firebaseio.com") };
  });
  return connection;
}
const hex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
const newToken = () => hex(crypto.getRandomValues(new Uint8Array(32)));

function fail(message, status) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

export async function administratorReady() {
  const fb = await connect();
  await fb.auth.authStateReady();
  const user = fb.auth.currentUser;
  return Boolean(user && (await fb.get(fb.ref(fb.db, "admins/" + user.uid))).val() === true);
}

export async function activateAdmin(password) {
  const fb = await connect();
  await fb.signInWithEmailAndPassword(fb.auth, "admin@amigo-invisible-b52dd.invalid", password);
  const allowed = await administratorReady();
  if (!allowed) await fb.signOut(fb.auth);
  return allowed;
}

export async function api(path, token, body) {
  const fb = await connect();
  const ref = child => fb.ref(fb.db, child ? "live/" + child : "live");
  const get = async child => (await fb.get(ref(child))).val();
  if (path === "enter") {
    const name = body.name.trim().replace(/\s+/gu, " ");
    if (!name || name.length > 60) fail("Ingresá un nombre de hasta 60 caracteres.", 400);
    const canonical = name.normalize("NFC").toLocaleLowerCase("es-UY");
    if (canonical === "admin1") {
      if (!(await administratorReady())) fail("Abrí tu enlace privado para habilitar el administrador.", 403);
      return { admin: true, token: true };
    }
    const key = hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical))));
    if (token && (await get("tickets/" + token))?.key === key) return { token };
    if (await get("round")) fail("El sorteo ya se hizo. Abrí tu enlace personal.", 409);
    const personal = newToken();
    try {
      await fb.update(ref(), { ["tickets/" + personal]: { name, key }, ["names/" + key]: personal });
      return { token: personal };
    } catch {
      fail("No pudimos registrar el nombre. Si ya lo usaste, abrí tu enlace personal o agregá un apellido.", 409);
    }
  }
  if (path === "participant") {
    const person = await get("tickets/" + token);
    if (!person) fail("Este enlace personal no es válido.", 404);
    return { name: person.name, recipient: person.recipient, drawn: Boolean(person.round), round: person.round };
  }
  if (path === "audit") {
    const summary = await get("verification/" + token);
    if (!summary) fail("Este enlace de auditoría ya no está disponible.", 404);
    return summary;
  }
  if (!(await administratorReady())) fail("Abrí tu enlace privado para habilitar el administrador.", 403);
  const current = (await get()) ?? {};
  if (path === "admin") {
    const people = Object.values(current.tickets ?? {});
    return { names: people.map(person => person.name), selected: people.filter(person => person.recipient).map(person => person.name),
      audit: current.audit ?? null, round: current.round ?? 0 };
  }
  if (path === "draw") {
    const { selected, previousAudit } = body;
    const nextAudit = newToken();
    let firstAttempt = true;
    const transaction = await fb.runTransaction(ref(), data => {
      if (firstAttempt) data ??= current;
      firstAttempt = false;
      if (!data || (data.audit ?? null) !== previousAudit) return;
      const people = Object.values(data.tickets ?? {});
      const names = new Set(people.map(person => person.name));
      if (!Array.isArray(selected) || selected.length < 2 || new Set(selected).size !== selected.length ||
          selected.length > names.size || !selected.every(name => names.has(name))) return;
      const draw = createDraw(selected);
      const assignments = new Map(draw.names.map((name, index) => [name, draw.names[draw.recipients[index]]]));
      data.round = (data.round ?? 0) + 1;
      for (const person of people) {
        person.round = data.round;
        const recipient = assignments.get(person.name);
        if (recipient) person.recipient = recipient;
        else delete person.recipient;
      }
      data.audit = nextAudit;
      const assigned = Array.from(assignments.values());
      data.verification = { [nextAudit]: { round: data.round, count: selected.length,
        assigned: assigned.length, unique: new Set(assigned).size,
        allEligible: assigned.every(name => assignments.has(name)),
        nobodySelf: Array.from(assignments).every(([person, recipient]) => person !== recipient) } };
      return data;
    }, { applyLocally: false });
    if (!transaction.committed) fail("La ronda o la lista cambió. Revisá la selección y volvé a intentar.", 409);
    return { audit: nextAudit };
  }
  fail("Este enlace no está disponible.", 404);
}
