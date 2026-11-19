import { createDraw, decodeDraw, encodeDraw } from "./draw.mjs";

const find = id => document.getElementById(id);
const organizer = find("organizer");
const participant = find("participant");
const people = find("people");
const status = find("status");
const link = find("link");
const result = find("result");
let draw;

function resetSelection() {
  people.value = "";
  find("choose").hidden = false;
  find("confirm").hidden = true;
  find("reveal").hidden = false;
  result.textContent = "";
}

function showPage() {
  status.textContent = "";
  draw = undefined;
  participant.hidden = true;
  organizer.hidden = Boolean(location.hash);
  people.length = 1;
  resetSelection();

  if (!location.hash) return;
  try {
    draw = decodeDraw(location.hash.slice(1));
    draw.names.forEach((name, index) => people.add(new Option(name, index)));
    participant.hidden = false;
  } catch {
    status.textContent = "No pudimos abrir este sorteo. Pedile a quien lo organizó que te reenvíe el enlace.";
  }
}

find("create").addEventListener("submit", event => {
  event.preventDefault();
  try {
    const names = find("names").value.split(/\r?\n/u).map(name => name.trim()).filter(Boolean);
    const url = new URL(location.href);
    url.hash = encodeDraw(createDraw(names));
    link.value = url.href;
    find("open").href = url.href;
    find("share").hidden = false;
    status.textContent = "Sorteo listo para compartir.";
  } catch (error) {
    find("share").hidden = true;
    status.textContent = error.message;
  }
});

find("copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(link.value);
    status.textContent = "Enlace copiado.";
  } catch {
    link.focus();
    link.select();
    status.textContent = "Copiá el enlace seleccionado.";
  }
});

people.addEventListener("change", () => {
  if (!draw || people.value === "") return;
  const identity = find("identity");
  identity.textContent = `Sos ${draw.names[Number(people.value)]}`;
  find("choose").hidden = true;
  find("confirm").hidden = false;
  identity.focus();
});

find("reveal").addEventListener("click", () => {
  if (!draw || people.value === "") return;
  const recipient = draw.recipients[Number(people.value)];
  result.textContent = `Te toca regalarle a ${draw.names[recipient]}.`;
  find("reveal").hidden = true;
  find("back").focus();
});

find("back").addEventListener("click", () => {
  resetSelection();
  people.focus();
});

window.addEventListener("hashchange", showPage);
showPage();
