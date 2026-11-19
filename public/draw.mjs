const maxPeople = 100;
const maxNameLength = 60;

export function validateNames(names) {
  if (!Array.isArray(names) || names.length < 2 || names.length > maxPeople) {
    throw new Error("Ingresá entre 2 y 100 participantes.");
  }
  const seen = new Set();
  for (const name of names) {
    if (typeof name !== "string" || !name.trim() || name.length > maxNameLength || /[\r\n]/u.test(name)) {
      throw new Error("Cada nombre debe tener entre 1 y 60 caracteres.");
    }
    const key = name.trim().normalize("NFC").toLocaleLowerCase("es-UY");
    if (seen.has(key)) throw new Error("Hay nombres repetidos. Agregá un apellido o apodo.");
    seen.add(key);
  }
}

function randomIndex(size) {
  const word = new Uint32Array(1);
  const limit = 2 ** 32 - (2 ** 32 % size);
  do {
    crypto.getRandomValues(word);
  } while (word[0] >= limit);
  return word[0] % size;
}

export function createDraw(names) {
  validateNames(names);
  const recipients = names.map((_, index) => index);
  // Rechazar las permutaciones con autoasignaciones da un sorteo uniforme.
  do {
    for (let index = recipients.length - 1; index > 0; index--) {
      const other = randomIndex(index + 1);
      [recipients[index], recipients[other]] = [recipients[other], recipients[index]];
    }
  } while (recipients.some((recipient, index) => recipient === index));
  return { names, recipients };
}

export function encodeDraw(draw) {
  const bytes = new TextEncoder().encode(JSON.stringify(draw));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function decodeDraw(encoded) {
  if (encoded.length > 60000 || !/^[A-Za-z0-9_-]+$/u.test(encoded)) throw new Error("Enlace inválido.");
  const bytes = Uint8Array.from(atob(encoded.replaceAll("-", "+").replaceAll("_", "/")), char => char.charCodeAt(0));
  const { names, recipients } = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  validateNames(names);
  if (!Array.isArray(recipients) || recipients.length !== names.length ||
      new Set(recipients).size !== names.length ||
      recipients.some((value, index) => !Number.isInteger(value) || value < 0 || value >= names.length || value === index)) {
    throw new Error("Asignaciones inválidas.");
  }
  return { names, recipients };
}
