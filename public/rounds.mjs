import { api, watchAdmin } from "./rounds-api.mjs?v=9";

const hash = location.hash.slice(1);
if (/^(?:join|organize)\//u.test(hash) || (/^[A-Za-z0-9_-]+$/u.test(hash) && hash.length > 20)) {
  location.replace(new URL("previous.html" + location.hash, location.href));
}

const find = id => document.getElementById(id);
const status = find("status");
const views = ["home", "participant", "admin", "audit"];
let adminToken;
let displayedAudit;
let displayedRound;
let cancelTarget;
let displayedNames;
let drawPending = false;
let timer;
let stopWatchingAdmin;
let refreshVersion = 0;
let generation = 0;
let personalToken;
try { personalToken = localStorage.getItem("amigo-personal"); } catch {}

function show(view) {
  if (view === "home") find("existing-player").hidden = !personalToken;
  for (const item of views) find(item).hidden = item !== view;
}

function link(hash) {
  const url = new URL(location.href);
  url.hash = hash;
  return url.href;
}

function selectedNames() {
  return Array.from(find("roster").querySelectorAll("input:checked"), checkbox => checkbox.value);
}

function updateDrawButton() {
  find("draw").disabled = drawPending || selectedNames().length < 2;
}

function renderAdmin(data) {
  find("registration-link").value = new URL("/inscripcion", location.origin).href;
  find("count").textContent = `Participantes registrados (${data.names.length})`;
  const namesKey = JSON.stringify(data.names);
  if (displayedNames !== namesKey || displayedAudit !== data.audit) {
    const selected = new Set(displayedAudit === data.audit ? selectedNames() : data.selected);
    const previous = new Set(displayedNames === undefined ? [] : JSON.parse(displayedNames));
    const rows = data.names.map(name => {
      const item = document.createElement("li");
      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = name;
      checkbox.checked = selected.has(name) || (!data.audit && !previous.has(name));
      label.append(checkbox, document.createTextNode(name));
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "secondary";
      remove.textContent = "Eliminar";
      remove.setAttribute("aria-label", `Eliminar a ${name}`);
      remove.onclick = () => removePerson(name, remove);
      item.append(label, remove);
      return item;
    });
    find("roster").replaceChildren(...rows);
    displayedNames = namesKey;
    displayedAudit = data.audit;
  }
  displayedRound = data.round;
  const active = Boolean(data.audit && !data.cancelled);
  if (!active || cancelTarget !== data.round) cancelTarget = undefined;
  find("cancel-round").hidden = !active || Boolean(cancelTarget);
  find("cancel-confirmation").hidden = !cancelTarget;
  find("draw").textContent = active ? "Volver a lanzar el sorteo" : "Lanzar sorteo";
  updateDrawButton();
  find("audit-share").hidden = !active;
  if (active) {
    find("round").textContent = `Ronda ${data.round} publicada.`;
    find("audit-link").value = link(`auditoria/${data.audit}`);
  }
}

async function removePerson(name, button) {
  if (!window.confirm(`¿Eliminar a ${name}? Su enlace personal dejará de funcionar.`)) return;
  button.disabled = true;
  status.textContent = "";
  try {
    await api("remove", adminToken, { name });
    await refresh("admin", adminToken, generation);
    status.textContent = `Eliminaste a ${name}.`;
  } catch (error) {
    status.textContent = error.message;
    button.disabled = false;
  }
}

function listItem(text) {
  const element = document.createElement("li");
  element.textContent = text;
  return element;
}

async function refresh(route, token, current) {
  const version = ++refreshVersion;
  const path = { admin: "admin", personal: "participant", auditoria: "audit" }[route];
  try {
    const data = await api(path, token);
    if (current !== generation || version !== refreshVersion) return;
    if (route === "admin") {
      renderAdmin(data);
      show("admin");
    } else if (route === "personal") {
      personalToken = token;
      try { localStorage.setItem("amigo-personal", token); } catch {}
      find("identity").textContent = data.name;
      if (location.hash.startsWith("#personal/")) history.replaceState(null, "", link("jugador"));
      find("waiting").hidden = Boolean(data.recipient);
      find("waiting").textContent = data.drawn ? "No participás en esta ronda. Esperá al próximo sorteo." : "Esperá a que se haga el sorteo.";
      const message = data.recipient ? `Te toca regalarle a ${data.recipient}.` : "";
      if (find("result").textContent !== message) find("result").textContent = message;
      find("participant-round").hidden = !data.drawn;
      if (data.drawn) find("participant-round").textContent = `Ronda ${data.round}`;
      show("participant");
    } else {
      const valid = data.count >= 2 && data.count === data.assigned && data.count === data.unique && data.allEligible && data.nobodySelf;
      find("audit-result").textContent = valid ? "El sorteo pasó todas las verificaciones." : "El sorteo tiene asignaciones inconsistentes.";
      find("audit-details").replaceChildren(...[
        `Ronda: ${data.round}`,
        `Participantes: ${data.count}`,
        `Personas con asignación: ${data.assigned}`,
        `Destinatarios distintos: ${data.unique}`,
        data.allEligible ? "Todos los destinatarios están registrados." : "Hay un destinatario que no está registrado.",
        data.nobodySelf ? "Nadie se sacó a sí mismo." : "Hay personas que se sacaron a sí mismas.",
      ].map(listItem));
      const pairs = Object.values(data.pairs ?? {});
      const assignments = find("audit-pairs");
      assignments.replaceChildren(...pairs.map(({ giver, recipient }) => listItem(`${giver} le regala a ${recipient}.`)));
      assignments.hidden = pairs.length === 0;
      find("audit-pairs-heading").hidden = assignments.hidden;
      show("audit");
    }
  } catch (error) {
    if (current !== generation || version !== refreshVersion) return;
    status.textContent = error.message;
    if (route === "personal" && error.status === 404) {
      clearInterval(timer);
      if (personalToken === token) {
        personalToken = undefined;
        try { localStorage.removeItem("amigo-personal"); } catch {}
      }
      if (location.hash === "#jugador") {
        history.replaceState(null, "", link(""));
        show("home");
      } else show();
    }
  }
}

async function load() {
  const current = ++generation;
  clearInterval(timer);
  stopWatchingAdmin?.();
  stopWatchingAdmin = undefined;
  status.textContent = "";
  find("result").textContent = "";
  let [route, token, extra] = location.hash.slice(1).split("/");
  if (route === "jugador" && token === undefined) {
    route = "personal";
    token = personalToken;
  }
  if (!route) {
    adminToken = undefined;
    show("home");
    return;
  }
  if (route === "admin" && !token) {
    if (!adminToken) {
      show();
      status.textContent = "Abriendo el panel…";
      try {
        const auth = await api("enter", null, { name: "admin1" });
        if (current !== generation) return;
        adminToken = auth.token;
        status.textContent = "";
      } catch {
        if (current !== generation) return;
        show("home");
        status.textContent = "No pudimos abrir el panel. Recargá la página para volver a intentar.";
        return;
      }
    }
    await refresh(route, adminToken, current);
    if (current !== generation) return;
    const update = () => refresh("admin", adminToken, current);
    timer = setInterval(update, 15000);
    try {
      const stop = await watchAdmin(update);
      if (current === generation) stopWatchingAdmin = stop;
      else stop();
    } catch (error) {
      console.error(error);
    }
    return;
  }
  if (!extra && ["personal", "auditoria"].includes(route) && /^[a-f0-9]{64}$/u.test(token ?? "")) {
    show();
    await refresh(route, token, current);
    if (route === "personal" && current === generation && !status.textContent) timer = setInterval(() => refresh(route, token, current), 2000);
    return;
  }
  show("home");
}

find("enter").onsubmit = async event => {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button");
  button.disabled = true;
  status.textContent = "";
  try {
    const data = await api("enter", personalToken, { name: find("name").value });
    if (data.admin) {
      adminToken = data.token;
      if (location.hash === "#admin") await load();
      else location.hash = "admin";
    } else {
      personalToken = data.token;
      try { localStorage.setItem("amigo-personal", data.token); } catch {}
      if (location.hash === "#jugador") await load();
      else location.hash = "jugador";
    }
    event.target.reset();
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
};

find("cancel-round").onclick = () => {
  cancelTarget = displayedRound;
  find("cancel-round").hidden = true;
  find("cancel-confirmation").hidden = false;
  find("confirm-cancel").focus();
};

find("keep-round").onclick = () => {
  cancelTarget = undefined;
  find("cancel-confirmation").hidden = true;
  find("cancel-round").hidden = false;
  find("cancel-round").focus();
};

find("confirm-cancel").onclick = async () => {
  const target = cancelTarget;
  if (!target) return;
  const button = find("confirm-cancel");
  button.disabled = true;
  status.textContent = "";
  try {
    await api("cancel", adminToken, { round: target });
    cancelTarget = undefined;
    await refresh("admin", adminToken, generation);
    status.textContent = "Sorteo cancelado. Los participantes están esperando una nueva ronda.";
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
};

find("roster").onchange = updateDrawButton;

find("draw").onclick = async () => {
  const selected = selectedNames();
  if (drawPending || selected.length < 2) return;
  const prompt = displayedAudit
    ? `¿Volver a sortear entre ${selected.length} personas? Se reemplazarán las asignaciones anteriores.`
    : `¿Lanzar el sorteo entre ${selected.length} personas?`;
  if (!window.confirm(prompt)) return;
  drawPending = true;
  updateDrawButton();
  try {
    await api("draw", adminToken, { selected, previousAudit: displayedAudit });
    await refresh("admin", adminToken, generation);
  } catch (error) {
    status.textContent = error.message;
  } finally {
    drawPending = false;
    updateDrawButton();
  }
};

document.querySelectorAll("[data-copy]").forEach(button => {
  button.onclick = async () => {
    const input = find(button.dataset.copy);
    try {
      await navigator.clipboard.writeText(input.value);
      status.textContent = "Enlace copiado.";
    } catch {
      input.focus();
      input.select();
      status.textContent = "Copiá el enlace seleccionado.";
    }
  };
});

window.addEventListener("hashchange", load);
await load();
