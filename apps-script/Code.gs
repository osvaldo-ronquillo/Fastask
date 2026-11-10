/**
 * Puente "Bandeja FasTask" para FasTask.
 *
 * Instalacion (una sola vez, con la cuenta dueña de la hoja):
 *  1. Abre la hoja "Bandeja FasTask" > Extensiones > Apps Script.
 *  2. Pega este archivo completo en Code.gs y guarda.
 *  3. Configuracion del proyecto (engrane) > Propiedades del script > Agregar propiedad:
 *       TOKEN = una clave larga y aleatoria (la misma que pegaras en FasTask).
 *  4. Implementar > Nueva implementacion > Tipo: Aplicacion web.
 *       Ejecutar como: Yo.   Quien tiene acceso: Cualquier persona.
 *     Copia la URL que termina en /exec.
 *  5. En FasTask, boton Sincronizar: pega la URL y el TOKEN.
 *
 * Si cambias este codigo: Implementar > Administrar implementaciones > editar > Nueva version.
 *
 * Seguridad: sin el TOKEN correcto el script no devuelve ni modifica nada.
 * El TOKEN vive solo en las propiedades del script y en el navegador de cada dispositivo,
 * nunca en el repositorio.
 */

const SHEET_NAME = "Hoja 1";
const STATUS_NEW = "nuevo";
const STATUS_DONE = "importada";
const MAX_ROWS = 50;

function doGet(e) {
  try {
    check_(e.parameter && e.parameter.token);
    if ((e.parameter.action || "") !== "list") return json_({ ok: false, error: "accion invalida" });

    const sh = sheet_();
    const data = read_(sh);
    const c = col_(data.headers);
    const rows = [];

    data.values.forEach(function (v, i) {
      if (rows.length >= MAX_ROWS) return;
      if (String(v[c.estado]).trim().toLowerCase() !== STATUS_NEW) return;
      if (!String(v[c.titulo]).trim()) return;
      rows.push({
        row: i + 2,
        fecha: text_(v[c.fecha]),
        titulo: String(v[c.titulo]),
        categoria: String(v[c.categoria] || "").trim(),
        contexto: String(v[c.contexto] || "").trim(),
        fuente: String(v[c.fuente] || "").trim(),
        id_origen: String(v[c.id_origen] || "").trim()
      });
    });

    return json_({ ok: true, rows: rows });
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    const body = JSON.parse(e.postData.contents);
    check_(body.token);
    if (body.action !== "mark") return json_({ ok: false, error: "accion invalida" });

    lock.waitLock(10000);
    const sh = sheet_();
    const c = col_(read_(sh).headers);
    const last = sh.getLastRow();
    let marked = 0;

    (body.rows || []).forEach(function (n) {
      n = Number(n);
      if (!Number.isInteger(n) || n < 2 || n > last) return;
      const cell = sh.getRange(n, c.estado + 1);
      if (String(cell.getValue()).trim().toLowerCase() === STATUS_NEW) {
        cell.setValue(STATUS_DONE);
        marked++;
      }
    });

    return json_({ ok: true, marked: marked });
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}

/* ---------- helpers ---------- */

function check_(token) {
  const expected = PropertiesService.getScriptProperties().getProperty("TOKEN");
  if (!expected || !token || String(token) !== expected) throw new Error("no autorizado");
}

function sheet_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sh) throw new Error("no existe la pestaña " + SHEET_NAME);
  return sh;
}

function read_(sh) {
  const last = sh.getLastRow();
  const width = sh.getLastColumn();
  if (last < 1 || width < 1) throw new Error("hoja vacia");
  const all = sh.getRange(1, 1, last, width).getValues();
  return {
    headers: all[0].map(function (h) { return String(h).trim().toLowerCase(); }),
    values: all.slice(1)
  };
}

function col_(headers) {
  const need = ["fecha", "titulo", "categoria", "contexto", "fuente", "id_origen", "estado"];
  const c = {};
  need.forEach(function (name) {
    const i = headers.indexOf(name);
    if (i < 0) throw new Error("falta la columna " + name);
    c[name] = i;
  });
  return c;
}

function text_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm");
  return String(v || "").replace(/^[@\s]+/, "").trim();
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
