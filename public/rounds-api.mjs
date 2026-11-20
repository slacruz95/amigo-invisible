import { createDraw } from "./draw.mjs";

const sdk = "https://www.gstatic.com/firebasejs/11.10.0";
let connection;
let signingIn;
const claims = new Set();

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

async function session(fb) {
  await fb.auth.authStateReady();
  if (fb.auth.currentUser) return fb.auth.currentUser;
  signingIn ??= fb.signInAnonymously(fb.auth).then(result => result.user)
    .finally(() => { signingIn = undefined; });
  return signingIn;
}

const hex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
const newToken = () => hex(crypto.getRandomValues(new Uint8Array(32)));

function fail(message, status) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

export async function watchAdmin(onChange) {
  const fb = await connect();
  await session(fb);
  let pending;
  const stops = ["roster", "removed", "latest", "cancelled"].map(path =>
    fb.onValue(fb.ref(fb.db, "live/board/" + path), () => {
      clearTimeout(pending);
      pending = setTimeout(onChange, 50);
    }, error => console.error(error))
  );
  return () => {
    clearTimeout(pending);
    for (const stop of stops) stop();
  };
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
      await session(fb);
      return { admin: true, token: true };
    }
    const key = hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical))));
    const previous = token ? await get("tickets/" + token) : null;
    if (previous && !(await get("board/removed/" + previous.key))) {
      if (previous.key !== key) fail("Ya te registraste. Usá el nombre anterior.", 409);
      return { token };
    }
    const personal = newToken();
    try {
      await fb.update(ref(), { ["tickets/" + personal]: { name, key }, ["names/" + key]: personal,
        ["board/roster/" + key]: name });
      return { token: personal };
    } catch {
      fail("No pudimos registrar el nombre. Si ya te registraste, usá el mismo navegador. Si el nombre pertenece a otra persona, agregá un apellido.", 409);
    }
  }
  if (path === "participant") {
    const [person, round, cancelled] = await Promise.all([
      get("tickets/" + token), get("board/latest"), get("board/cancelled"),
    ]);
    if (!person) fail("Este enlace personal no es válido.", 404);
    if (await get("board/removed/" + person.key)) fail("Este participante fue eliminado del sorteo.", 404);
    if (!round || cancelled === round) return { name: person.name, drawn: false };
    const user = await session(fb);
    const claim = `claims/${user.uid}/${person.key}`;
    if (!claims.has(claim)) {
      await fb.set(ref(claim), token);
      claims.add(claim);
    }
    let recipient;
    try { recipient = await get(`board/rounds/${round}/entries/${person.key}`); }
    catch (error) {
      const [latest, cancelledRound] = await Promise.all([get("board/latest"), get("board/cancelled")]);
      if (latest !== round || cancelledRound === round) return api(path, token, body);
      throw error;
    }
    return { name: person.name, recipient, drawn: true, round };
  }
  if (path === "audit") {
    let summary;
    try { summary = await get("board/verification/" + token); }
    catch (error) {
      if (error.code !== "PERMISSION_DENIED") throw error;
    }
    if (!summary) fail("Este enlace de auditoría ya no está disponible.", 404);
    return summary;
  }
  await session(fb);
  const [roster, latest, removed, cancelled] = await Promise.all([
    get("board/roster"), get("board/latest"), get("board/removed"), get("board/cancelled"),
  ]);
  if (path === "cancel") {
    if (!latest || body.round !== latest || cancelled === latest) {
      fail("Esa ronda ya no está activa. Actualizá el panel.", 409);
    }
    try {
      await fb.set(ref("board/cancelled"), latest);
    } catch {
      fail("No se pudo cancelar esa ronda. Actualizá el panel.", 409);
    }
    return { cancelled: true };
  }
  const entries = Object.entries(roster ?? {}).filter(([key]) => !removed?.[key]);
  if (path === "remove") {
    const entry = entries.find(([, name]) => name === body.name);
    if (!entry) fail("Esa persona ya no está en la lista.", 404);
    try {
      await fb.set(ref("board/removed/" + entry[0]), true);
    } catch {
      fail("No se pudo eliminar a esa persona. Actualizá la lista e intentá de nuevo.", 409);
    }
    return { removed: true };
  }
  const current = latest ? await get(`board/rounds/${latest}/panel`) : null;
  if (path === "admin") {
    const selected = new Set(Object.values(current?.selected ?? {}));
    return { names: entries.map(([, name]) => name), selected: entries.filter(([key]) => selected.has(key)).map(([, name]) => name),
      audit: current?.audit ?? null, round: latest ?? 0, cancelled: Boolean(latest && latest === cancelled) };
  }
  if (path === "draw") {
    const { selected, previousAudit } = body;
    if ((current?.audit ?? null) !== previousAudit) fail("Ya hay una ronda nueva. Revisá la selección.", 409);
    const keys = new Map(entries.map(([key, name]) => [name, key]));
    if (!Array.isArray(selected) || selected.length < 2 || new Set(selected).size !== selected.length ||
        selected.length > keys.size || !selected.every(name => keys.has(name))) {
      fail("Seleccioná al menos dos personas registradas.", 400);
    }
    const draw = createDraw(selected);
    const audit = newToken();
    const round = (latest ?? 0) + 1;
    const assignments = Object.fromEntries(draw.names.map((name, index) => [keys.get(name), draw.names[draw.recipients[index]]]));
    const recipients = Object.values(assignments);
    const summary = { round, count: selected.length, assigned: recipients.length, unique: new Set(recipients).size,
      allEligible: recipients.every(name => selected.includes(name)),
      nobodySelf: draw.recipients.every((recipient, index) => recipient !== index),
      pairs: draw.names.map((giver, index) => ({ giver, recipient: draw.names[draw.recipients[index]] })) };
    try {
      await fb.update(ref("board"), {
        latest: round,
        [`rounds/${round}`]: { panel: { audit, selected: selected.map(name => keys.get(name)) }, entries: assignments },
        [`verification/${audit}`]: summary,
      });
    } catch {
      fail("La ronda o la lista cambió. Revisá la selección y volvé a intentar.", 409);
    }
    return { audit };
  }
  fail("Este enlace no está disponible.", 404);
}
