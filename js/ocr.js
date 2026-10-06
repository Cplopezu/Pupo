// Lectura de boletas: OCR con Tesseract.js (carga diferida) + interpretación de campos chilenos.
import { parseMonto } from './util.js';

const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
let workerPromise;

function cargarScript(src) {
  return new Promise((res, rej) => {
    if (window.Tesseract) return res();
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = res; s.onerror = () => rej(new Error('No se pudo cargar el motor OCR (¿sin conexión?)'));
    document.head.appendChild(s);
  });
}

let onProgreso = () => {};
async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      await cargarScript(TESSERACT_URL);
      return window.Tesseract.createWorker('spa', 1, {
        logger: m => { if (m.status === 'recognizing text') onProgreso(m.progress); },
      });
    })().catch(e => { workerPromise = null; throw e; });
  }
  return workerPromise;
}

export async function leerBoleta(blob, progreso = () => {}) {
  onProgreso = progreso;
  const worker = await getWorker();
  const { data } = await worker.recognize(blob);
  return { texto: data.text, ...interpretar(data.text) };
}

// Extrae monto total, fecha, RUT, folio y comercio desde el texto OCR.
export function interpretar(texto) {
  const lineas = texto.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const out = {};

  // TOTAL: prioriza líneas con "TOTAL" (no subtotal), toma el último número de la línea.
  const reMonto = /\$?\s*(\d{1,3}(?:[.,\s]\d{3})+|\d+)(?:,\d{1,2})?/g;
  const montosDe = l => [...l.matchAll(reMonto)].map(m => parseMonto(m[0].replace(/\s/g, ''))).filter(n => n > 0 && n < 1e9);
  const candidatos = [];
  lineas.forEach((l, i) => {
    const u = l.toUpperCase();
    if (/\bTOTAL\b/.test(u) && !/SUB\s*TOTAL|TOTAL\s+ITEM|N[°º]?\s*ITEM|ARTICULOS/.test(u)) {
      let ms = montosDe(l);
      if (!ms.length && lineas[i + 1]) ms = montosDe(lineas[i + 1]);
      if (ms.length) candidatos.push({ v: ms[ms.length - 1], peso: /A\s*PAGAR|TOTAL\s*\$|^TOTAL/.test(u) ? 2 : 1 });
    }
  });
  if (candidatos.length) {
    candidatos.sort((a, b) => b.peso - a.peso || b.v - a.v);
    out.monto = candidatos[0].v;
  } else {
    const todos = lineas.flatMap(montosDe).filter(n => n >= 100);
    if (todos.length) out.monto = Math.max(...todos);
  }

  // Fecha dd/mm/aaaa, dd-mm-aa, dd.mm.aaaa
  const mf = texto.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/);
  if (mf) {
    let [, d, m, y] = mf.map(Number);
    if (y < 100) y += 2000;
    if (d >= 1 && d <= 31 && m >= 1 && m <= 12 && y >= 2000 && y <= 2100) {
      out.fecha = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  // RUT emisor
  const mr = texto.match(/\b(\d{1,2}\.?\d{3}\.?\d{3})\s*-\s*([\dkK])\b/);
  if (mr) {
    const cuerpo = mr[1].replace(/\./g, '');
    out.rut = `${Number(cuerpo).toLocaleString('es-CL')}-${mr[2].toUpperCase()}`;
  }

  // Folio
  const mfo = texto.match(/(?:FOLIO|BOLETA[^\n\d]{0,30}N[°ºo.]?|N[°º]\s*)\s*:?\s*(\d{3,12})/i);
  if (mfo) out.folio = mfo[1];

  // Comercio: primera línea "con letras" que no sea encabezado tributario
  const ignorar = /BOLETA|ELECTR|R\.?U\.?T|SII|GIRO|FACTURA|FECHA|DIRECCI|CASA MATRIZ|TEL|^\W+$/i;
  const nombre = lineas.find(l => /[A-Za-zÁÉÍÓÚÑ]{3,}/.test(l) && !ignorar.test(l) && l.length <= 40);
  if (nombre) out.comercio = nombre.replace(/[^\wÁÉÍÓÚÑáéíóúñ&.\- ]/g, '').replace(/\s+/g, ' ').trim();

  return out;
}
