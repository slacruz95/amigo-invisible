import { createDraw, decodeDraw } from "./draw.mjs";

const find = id => document.getElementById(id);
const status = find("status");
const roomPattern = /^[a-f0-9]{32}$/;
const adminEmail = "admin@amigo-invisible-b52dd.invalid";
const ticketPattern = /^[a-f0-9]{64}$/;
const viewIds = ["home", "login", "admin", "join", "personal", "legacy"];
let firebase;
let generation = 0;
let subscriptions = [];
let participant;
const memory = new Map();

function stored(key) {
  try { return memory.get(key) ?? localStorage.getItem(key); }
  catch { return memory.get(key); }
}

function remember(key, value) {
  memory.set(key, value);
  try { localStorage.setItem(key, value); }
  catch { /* The personal link can still be saved. */ }
}

function show(id) {
  for (const view of viewIds) find(view).hidden = view !== id;
}

function randomHex(size) {
  return Array.from(crypto.getRandomValues(new Uint8Array(size)), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function nameKey(name) {
  const canonical = name.normalize("NFC").toLocaleLowerCase("es-UY");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

function routeUrl(hash) {
  const url = new URL(location.href);
  url.hash = hash;
  return url.href;
}

function personalUrl(room, token) {
  return routeUrl(`join/${room}/${token}`);
}

async function connect() {
  const sdk = "https://www.gstatic.com/firebasejs/11.10.0";
  const [app, auth, database, response] = await Promise.all([
    import(`${sdk}/firebase-app.js`),
    import(`${sdk}/firebase-auth.js`),
    import(`${sdk}/firebase-database.js`),
    fetch("/__/firebase/init.json"),
  ]);
  if (!response.ok) throw new Error("No se pudo cargar Firebase.");
  const config = await response.json();
  const instance = app.initializeApp(config);
  return { ...auth, ...database, auth: auth.getAuth(instance), db: database.getDatabase(instance, config.databaseURL ?? "https://amigo-invisible-b52dd-default-rtdb.firebaseio.com") };
}

async function adminUid() {
  await firebase.auth.authStateReady();
  const user = firebase.auth.currentUser;
  if (!user || user.isAnonymous) return null;
  const permission = await firebase.get(dbRef(`admins/${user.uid}`));
  return permission.val() === true ? user.uid : null;
}

function listGroups(current) {
  const picker = find("group-picker");
  watch("rooms", current, rooms => {
    const groups = Object.entries(rooms ?? {}).sort((a, b) => (b[1].createdAt ?? 0) - (a[1].createdAt ?? 0));
    picker.replaceChildren(new Option("Elegí un grupo", ""));
    for (const [id, group] of groups) {
      const count = Object.keys(group.tickets ?? {}).length;
      const phase = group.phase === "drawn" ? "Sorteado" : "Inscripción abierta";
      picker.add(new Option(`Grupo ${id.slice(-6)} · ${phase} · ${count} participantes`, id));
    }
    find("saved-groups").hidden = groups.length === 0;
  });
}

function dbRef(path) {
  return firebase.ref(firebase.db, path);
}

function watch(path, current, handle, onError = () => {
  status.textContent = "No pudimos cargar los datos. Volvé a abrir el enlace.";
}) {
  subscriptions.push(firebase.onValue(dbRef(path), snapshot => {
    if (current === generation) handle(snapshot.val());
  }, () => {
    if (current === generation) onError();
  }));
}

async function copyValue(input, label = "Enlace copiado.") {
  try {
    await navigator.clipboard.writeText(input.value);
    status.textContent = label;
  } catch {
    input.focus();
    input.select();
    status.textContent = "Copiá el enlace seleccionado.";
  }
}

function adminView(room, current) {
  const invite = routeUrl(`join/${room}`);
  find("invite").value = invite;
  find("open-invite").href = invite;
  watch(`rooms/${room}`, current, data => {
    if (!data) {
      show();
      status.textContent = "No pudimos abrir este grupo.";
      return;
    }
    const entries = Object.entries(data.tickets ?? {});
    const roster = find("roster");
    roster.replaceChildren();
    for (const [token, person] of entries.sort((a, b) => a[1].name.localeCompare(b[1].name, "es-UY"))) {
      const item = document.createElement("li");
      const name = document.createElement("span");
      const action = document.createElement("button");
      name.textContent = person.name;
      action.textContent = data.phase === "open" ? "Quitar" : "Renovar enlace";
      action.className = "secondary";
      action.type = "button";
      action.onclick = () => manageTicket(room, token, person, data.phase);
      item.append(name, action);
      roster.append(item);
    }
    find("count").textContent = `Participantes (${entries.length})`;
    find("empty").hidden = entries.length > 0;
    find("launch").hidden = data.phase === "drawn";
    find("launch").disabled = entries.length < 2 || entries.length > 100;
    find("admin-phase").textContent = data.phase === "drawn" ? "Sorteo lanzado. Cada persona ya puede ver su asignación." :
      entries.length > 100 ? "El sorteo admite hasta 100 participantes." : "Lanzá el sorteo cuando estén todos. La inscripción se cerrará en ese momento.";
    show("admin");
  }, () => {
    show();
    status.textContent = "No pudimos abrir este grupo.";
  });
}

async function manageTicket(room, token, person, phase) {
  const removing = phase === "open";
  const prompt = removing ? `¿Quitar a ${person.name} del grupo?` : `¿Renovar el enlace de ${person.name}? El anterior dejará de funcionar.`;
  if (!window.confirm(prompt)) return;
  const replacement = removing ? null : randomHex(32);
  try {
    const transaction = await firebase.runTransaction(dbRef(`rooms/${room}`), data => {
      const ticket = data?.tickets?.[token];
      if (!ticket || data.phase !== phase) return;
      delete data.tickets[token];
      if (removing) delete data.names[ticket.key];
      else {
        data.tickets[replacement] = ticket;
        data.names[ticket.key] = replacement;
      }
      return data;
    }, { applyLocally: false });
    if (!transaction.committed) throw new Error("La lista cambió. Volvé a intentar.");
    if (removing) status.textContent = "Participante eliminado.";
    else {
      const link = document.createElement("input");
      link.value = personalUrl(room, replacement);
      link.readOnly = true;
      link.setAttribute("aria-label", "Nuevo enlace personal");
      status.replaceChildren(document.createTextNode(`Nuevo enlace de ${person.name}. Compartilo solo con esa persona.`), link);
      link.focus();
      link.select();
    }
  } catch (error) {
    status.textContent = error.message;
  }
}

function joinView(room, token, current) {
  let activeToken = token;
  const showRegistration = () => watch(`rooms/${room}/phase`, current, phase => {
    find("register").hidden = phase !== "open";
    find("closed").hidden = phase !== "drawn";
    status.textContent = phase ? "" : "No encontramos este grupo.";
    show(phase ? "join" : undefined);
  });

  if (!activeToken) {
    showRegistration();
    return;
  }
  watch(`rooms/${room}/tickets/${activeToken}`, current, ticket => {
    if (!ticket) {
      participant = undefined;
      if (activeToken && stored(`ticket/${room}`) === activeToken) remember(`ticket/${room}`, "");
      activeToken = "";
      show();
      status.textContent = "Este enlace personal ya no está activo. Pedile ayuda a quien organiza el sorteo.";
      if (!location.hash.split("/")[2]) showRegistration();
      return;
    }
    if (!activeToken) return;
    const previousRecipient = participant?.recipient;
    participant = ticket;
    remember(`ticket/${room}`, activeToken);
    find("identity").textContent = `Sos ${ticket.name}`;
    find("personal-link").value = personalUrl(room, activeToken);
    find("waiting").hidden = Boolean(ticket.recipient);
    if (ticket.recipient !== previousRecipient) find("result").textContent = "";
    find("reveal").hidden = !ticket.recipient || Boolean(find("result").textContent);
    status.textContent = "";
    show("personal");
  });
}

async function loadPage() {
  const current = ++generation;
  for (const stop of subscriptions.splice(0)) stop();
  participant = undefined;
  find("result").textContent = "";
  status.textContent = "";
  show();
  const hash = location.hash.slice(1);
  if (hash && hash !== "admin" && !hash.includes("/")) {
    try {
      const draw = decodeDraw(hash);
      const people = find("legacy-people");
      people.replaceChildren(new Option("Seleccioná tu nombre", ""));
      draw.names.forEach((name, index) => people.add(new Option(name, index)));
      find("legacy-result").textContent = "";
      people.onchange = () => { find("legacy-result").textContent = ""; };
      find("legacy-reveal").onclick = () => {
        if (people.value !== "") find("legacy-result").textContent = `Te toca regalarle a ${draw.names[draw.recipients[Number(people.value)]]}.`;
      };
      show("legacy");
    } catch {
      status.textContent = "No pudimos abrir este enlace.";
    }
    return;
  }

  const [mode, room, token, extra] = hash.split("/");
  try {
    if (!hash || hash === "admin") {
      const uid = await adminUid();
      if (current !== generation) return;
      find("admin-entry").hidden = Boolean(uid);
      find("admin-controls").hidden = !uid;
      if (uid) listGroups(current);
      show(hash === "admin" && !uid ? "login" : "home");
    } else if (!extra && roomPattern.test(room) && mode === "join" && (!token || ticketPattern.test(token))) {
      joinView(room, token || stored(`ticket/${room}`), current);
    } else if (!extra && roomPattern.test(room) && mode === "organize" && !token) {
      const uid = await adminUid();
      if (current !== generation) return;
      if (uid) adminView(room, current);
      else show("login");
    } else {
      status.textContent = "Este enlace no es válido.";
    }
  } catch {
    if (current === generation) status.textContent = "No pudimos abrir el sorteo. Volvé a intentar.";
  }
}

find("admin-login").onsubmit = async event => {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button");
  const password = find("admin-password");
  button.disabled = true;
  try {
    if (find("admin-user").value.trim().toLowerCase() !== "admin") throw new Error();
    await firebase.signInWithEmailAndPassword(firebase.auth, adminEmail, password.value);
    if (!(await adminUid())) {
      await firebase.signOut(firebase.auth);
      throw new Error();
    }
    password.value = "";
    if (location.hash === "#admin") location.hash = "";
    else await loadPage();
  } catch {
    status.textContent = "No pudimos ingresar. Revisá el usuario y la contraseña.";
  } finally {
    button.disabled = false;
  }
};

find("signout").onclick = async () => {
  await firebase.signOut(firebase.auth);
  await loadPage();
};

find("group-picker").onchange = event => {
  if (event.currentTarget.value) location.hash = `organize/${event.currentTarget.value}`;
};

find("create").onclick = async event => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const room = randomHex(16);
    const uid = await adminUid();
    if (!uid) throw new Error("Hace falta iniciar sesión como administrador.");
    await firebase.set(dbRef(`rooms/${room}`), { owner: uid, phase: "open", createdAt: firebase.serverTimestamp() });
    location.hash = `organize/${room}`;
  } catch (error) {
    status.textContent = "No pudimos crear el grupo. Volvé a intentar.";
    console.error(error);
  } finally {
    button.disabled = false;
  }
};

find("register").onsubmit = async event => {
  event.preventDefault();
  const room = location.hash.split("/")[1];
  const current = generation;
  const name = find("name").value.trim().replace(/\s+/gu, " ");
  if (!name) {
    status.textContent = "Escribí tu nombre.";
    return;
  }
  const button = event.currentTarget.querySelector("button");
  button.disabled = true;
  try {
    const token = randomHex(32);
    const key = await nameKey(name);
    await firebase.update(dbRef(`rooms/${room}`), {
      [`tickets/${token}`]: { name, key },
      [`names/${key}`]: token,
    });
    remember(`ticket/${room}`, token);
    if (current === generation) await loadPage();
  } catch {
    if (current === generation) status.textContent = "No pudimos registrar ese nombre. Si ya está usado, agregá un apellido o apodo. Si el sorteo cerró, usá tu enlace personal.";
  } finally {
    button.disabled = false;
  }
};

find("launch").onclick = async () => {
  if (!window.confirm("¿Lanzar el sorteo y cerrar la inscripción?")) return;
  const room = location.hash.split("/")[1];
  const button = find("launch");
  button.disabled = true;
  try {
    const transaction = await firebase.runTransaction(dbRef(`rooms/${room}`), data => {
      if (!data || data.phase !== "open") return;
      const tickets = Object.values(data.tickets ?? {});
      if (tickets.length < 2 || tickets.length > 100) return;
      const draw = createDraw(tickets.map(person => person.name));
      tickets.forEach((person, index) => { person.recipient = draw.names[draw.recipients[index]]; });
      data.phase = "drawn";
      return data;
    }, { applyLocally: false });
    if (!transaction.committed) status.textContent = "El sorteo ya se lanzó o la cantidad de participantes cambió.";
  } catch (error) {
    status.textContent = "No pudimos lanzar el sorteo. Volvé a intentar.";
    console.error(error);
  } finally {
    button.disabled = false;
  }
};

find("reveal").onclick = () => {
  if (!participant?.recipient) return;
  find("result").textContent = `Te toca regalarle a ${participant.recipient}.`;
  find("reveal").hidden = true;
};

document.querySelectorAll("[data-copy]").forEach(button => {
  button.onclick = () => copyValue(find(button.dataset.copy));
});

try {
  if (location.hash && location.hash !== "#admin" && !location.hash.slice(1).includes("/")) await loadPage();
  firebase = await connect();
  window.addEventListener("hashchange", loadPage);
  await loadPage();
} catch (error) {
  if (find("legacy").hidden) status.textContent = "No pudimos conectar con Firebase. Recargá la página para volver a intentar.";
  console.error(error);
}
