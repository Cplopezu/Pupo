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

const MARCAS = [
  [/JUMBO/i, 'Jumbo'], [/L[IÍ]DER|WALMART/i, 'Líder'], [/UNIMARC/i, 'Unimarc'], [/TOTTUS/i, 'Tottus'],
  [/SANTA\s*ISABEL/i, 'Santa Isabel'], [/ACUENTA/i, 'Acuenta'], [/CRUZ\s*VERDE/i, 'Cruz Verde'],
  [/SALCOBRAND/i, 'Salcobrand'], [/AHUMADA/i, 'Farmacias Ahumada'], [/COPEC/i, 'Copec'], [/SHELL|ENEX/i, 'Shell'],
  [/ARAMCO|PETROBRAS/i, 'Aramco'], [/SODIMAC|HOMECENTER/i, 'Sodimac'], [/\bEASY\b/i, 'Easy'], [/FALABELLA/i, 'Falabella'],
  [/RIPLEY/i, 'Ripley'], [/\bPARIS\b/i, 'Paris'], [/STARBUCKS/i, 'Starbucks'], [/MC\s*DONALD/i, "McDonald's"],
  [/DOGGIS/i, 'Doggis'], [/JUAN\s*MAESTRO/i, 'Juan Maestro'], [/CINEMARK/i, 'Cinemark'], [/OK\s*MARKET/i, 'OK Market'],
  [/OXXO/i, 'OXXO'], [/PRONTO\s*COPEC/i, 'Pronto Copec'], [/ANT[AÁ]RTICA/i, 'Librería Antártica'], [/PREUNIC/i, 'Preunic'],
];

// Nombres frecuentes en cartolas bancarias (no se usan al leer boletas: "SII" o "parking" aparecen en cualquier boleta)
const MARCAS_CARTOLA = [
  [/UBER\s*(TRIP|\*TRIP)?/i, 'Uber'], [/MERCADO\s*LIBRE|MERCADOLIBRE/i, 'Mercado Libre'], [/RED\s*MOVILIDAD/i, 'Red Movilidad (transporte público)'],
  [/CLARO\s*(RECAUDACION)?|CLAROTEL/i, 'Claro'], [/CIN[EÉ]POLIS/i, 'Cinépolis'], [/C\.\s*VERDE/i, 'Cruz Verde'], [/\bBK\b|BURGER\s*KING/i, 'Burger King'],
  [/COMUNIDAD\s*FELIZ|COMUNIDADFELIZ/i, 'ComunidadFeliz (gastos comunes)'], [/KRISPY|KRISPYKR/i, 'Krispy Kreme'], [/H&M/i, 'H&M'],
  [/CL[IÍ]NICA\s*ALEMANA/i, 'Clínica Alemana'], [/EQUIFAX/i, 'Equifax'], [/\bTGR\b/i, 'Tesorería (TGR)'], [/^SII\b|\bSII\s/i, 'SII'],
  [/LET\.?\s*HIPOTEC/i, 'Dividendo hipotecario'], [/MASVIDA/i, 'Isapre Nueva Masvida'], [/CINNABON/i, 'Cinnabon'],
  [/AKIPARK|PARKING|ESTACIONAMIENT/i, 'Estacionamiento'], [/AUTOPIST/i, 'Autopista'], [/WEBPAY\s*MUNICIPAL/i, 'Municipalidad (pago web)'],
];

// Devuelve el nombre normalizado si el texto corresponde a una marca conocida.
export function marcaConocida(texto) {
  const t = String(texto || '');
  const m = MARCAS.find(([re]) => re.test(t)) || MARCAS_CARTOLA.find(([re]) => re.test(t));
  return m ? m[1] : null;
}

const IGNORAR = /BOLETA|ELECTR|R\.?\s?U\.?\s?T|SII|GIRO|FACTURA|FECHA|HORA|DIRECCI|CASA MATRIZ|SUCURSAL|TEL[EÉ]F|FONO|CAJA|CAJERO|TOTAL|NETO|IVA|VUELTO|EFECTIVO|TARJETA|TIMBRE|VERIFIQUE|WWW|\.CL|@/i;
function esNombre(l) {
  const letras = (l.match(/[A-Za-zÁÉÍÓÚÑáéíóúñ]/g) || []).length;
  const digitos = (l.match(/\d/g) || []).length;
  return l.length >= 3 && l.length <= 45 && letras >= 3 && letras / l.length >= 0.55 && digitos <= 3 && !IGNORAR.test(l);
}
function limpiarNombre(l) {
  return l.replace(/[^\wÁÉÍÓÚÑáéíóúñ&.'\- ]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase()
    .replace(/(^|\s)(\p{L})/gu, (m, a, b) => a + b.toUpperCase())
    .replace(/\b(S\.?a\.?|Spa|Ltda\.?|Eirl)$/i, m => m.toUpperCase());
}

// Extrae monto total, fecha, RUT, folio y comercio desde el texto OCR.
export function interpretar(texto, hoyRef = new Date()) {
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

  // Fecha: acepta aaaa-mm-dd (ej. Copec "2026-10-09/09:12") y dd/mm/aaaa, dd-mm-aa, dd.mm.aaaa.
  // Solo se aceptan fechas reales y plausibles (último año y medio, no futuras); se prefiere la línea "Fecha".
  const plausible = (y, m, d) => {
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    const f = new Date(y, m - 1, d);
    if (f.getMonth() !== m - 1) return null;
    const dias = (hoyRef - f) / 86400000;
    return dias >= -2 && dias <= 550 ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null;
  };
  const fechas = [];
  lineas.forEach((l, i) => {
    const prioridad = /FECHA|EMISI/i.test(l) ? 0 : 1;
    for (const mm of l.matchAll(/(?<!\d)(20\d{2})[\/\-.](\d{1,2})[\/\-.](\d{1,2})(?!\d)/g)) {
      const f = plausible(+mm[1], +mm[2], +mm[3]); if (f) fechas.push({ f, prioridad, i });
    }
    for (const mm of l.matchAll(/(?<![\d\-\/.])(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4}|\d{2})(?![\d\-\/])/g)) {
      let y = +mm[3]; if (y < 100) y += 2000;
      const f = plausible(y, +mm[2], +mm[1]); if (f) fechas.push({ f, prioridad, i });
    }
  });
  fechas.sort((a, b) => a.prioridad - b.prioridad || a.i - b.i);
  if (fechas.length) out.fecha = fechas[0].f;

  // RUT emisor
  const mr = texto.match(/\b(\d{1,2}\.?\d{3}\.?\d{3})\s*-\s*([\dkK])\b/);
  if (mr) {
    const cuerpo = mr[1].replace(/\./g, '');
    out.rut = `${Number(cuerpo).toLocaleString('es-CL')}-${mr[2].toUpperCase()}`;
  }

  // Folio
  const mfo = texto.match(/BOLETA\s+ELECTR[OÓ]NICA\s*(?:N[°ºo.]*)?\s*:?\s*(\d{3,12})/i)
    || texto.match(/(?:FOLIO|BOLETA[^\n\d]{0,30}N[°ºo.]?|N[°º]\s*)\s*:?\s*(\d{3,12})/i);
  if (mfo) out.folio = mfo[1];

  // Comercio: 1) marca conocida en cualquier parte del texto, 2) razón social junto al RUT, 3) primera línea legible
  const marca = MARCAS.find(([re]) => re.test(texto));
  const iRut = lineas.findIndex(l => /R\.?\s?U\.?\s?T/i.test(l) || /\d{1,2}\.?\d{3}\.?\d{3}\s*-\s*[\dkK]/.test(l));
  const cercanas = iRut > 0 ? [lineas[iRut - 1], lineas[iRut - 2]] : [];
  const candidatas = [...cercanas, ...lineas.slice(0, 8)].filter(Boolean).filter(esNombre);
  const social = candidatas.find(l => /\b(S\.?A\.?|SPA|LTDA|LIMITADA|E\.?I\.?R\.?L)\b/i.test(l));
  const elegido = social || candidatas[0];
  if (marca) out.comercio = marca[1];
  else if (elegido) out.comercio = limpiarNombre(elegido);
  // Alternativas para elegir con un toque si la principal no es correcta
  out.candidatos = [...new Set([out.comercio, ...candidatas.map(limpiarNombre)].filter(Boolean))].slice(0, 4);

  return out;
}
