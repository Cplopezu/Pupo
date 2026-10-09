// Importación de cartolas / estados de cuenta en PDF (lectura en el propio equipo con pdf.js).
// Hoy reconoce el Estado de Cuenta de tarjeta de crédito de Banco Security; la estructura
// (fecha, código de referencia, descripción, montos, cuota) es común a otros bancos chilenos.
import { parseMonto } from './util.js';
import { marcaConocida } from './ocr.js';

const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
const PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';

function cargarPdfJs() {
  return new Promise((res, rej) => {
    if (window.pdfjsLib) return res(window.pdfjsLib);
    const s = document.createElement('script');
    s.src = PDFJS; s.async = true;
    s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; res(window.pdfjsLib); };
    s.onerror = () => rej(new Error('No se pudo cargar el lector de PDF (¿sin conexión?)'));
    document.head.appendChild(s);
  });
}

// Convierte el PDF en filas de texto con su posición horizontal: [{ x, s }, …] por línea.
export async function filasDePdf(datos, pdfjs) {
  pdfjs = pdfjs || await cargarPdfJs();
  const doc = await pdfjs.getDocument({ data: datos }).promise;
  let titulo = '';
  try { titulo = (await doc.getMetadata()).info?.Title || ''; } catch { /* sin metadatos */ }
  const filas = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    const porY = new Map();
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const y = Math.round(it.transform[5] / 3) * 3;
      if (!porY.has(y)) porY.set(y, []);
      porY.get(y).push({ x: it.transform[4], s: it.str.trim() });
    }
    [...porY.entries()].sort((a, b) => b[0] - a[0])
      .forEach(([, its]) => filas.push(its.sort((a, b) => a.x - b.x)));
  }
  return { filas, titulo };
}

const reFecha = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const reRef = /^\d{6,12}$/;
const reDinero = /^\$-?[\d.]+$/;
const isoDe = f => { const [, d, m, y] = f.match(reFecha); return `${y}-${m}-${d}`; };
const textoFila = fila => fila.map(i => i.s).join(' ');

// Limpia la descripción bancaria para dejar un nombre de comercio legible.
const PREFIJOS = /^(MERCADOPAGO|MERPAGO|MP|PAYU|RAPYD|PAYCWPS|TUU|FUDO|KS|TAW|SUMUP|SQ|PAYPAL|DLO|DL|GOOGLE|APPLE\.COM\/BILL)\s*\*\s*|^TAW\//i;
const CIUDADES = /\b(SANTIAGO|STGO|PROVIDENCIA|LAS CONDES|NUNOA|ÑUÑOA|VITACURA|LO BARNECHEA|LA REINA|MACUL|MAIPU|MAIPÚ|PUDAHUEL|COLINA|CONCEPCION|CONCEPCIÓN|VI[ÑN]A DEL MAR|VALPARAISO|CHILE|CL)\s*$/i;
export function limpiarComercio(desc) {
  let s = String(desc || '')
    .replace(/\bO?\s*TASA INT\.?\s*[\d,]*\s*%?/gi, ' ')
    .replace(/\s+/g, ' ').trim();
  s = s.replace(PREFIJOS, '').trim();
  for (let i = 0; i < 3; i++) s = s.replace(CIUDADES, '').trim();
  s = s.replace(/^\d+-/, '').replace(/\s+\d+$/, '').replace(/\s+TASA\s+[\d,]+\s*%$/i, '').trim();
  if (!s) s = String(desc || '').trim();
  const marca = marcaConocida(desc);
  if (marca) return marca;
  return s.toLowerCase().replace(/(^|[\s*.(/-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase())
    .replace(/\b(Spa|Sa|Ltda)\b\.?$/i, m => m.toUpperCase());
}

/**
 * Interpreta las filas de un estado de cuenta.
 * Devuelve los movimientos a considerar como gasto y los que se omiten (pagos, cuotas futuras).
 */
export function interpretarCartola({ filas, titulo = '' }) {
  const texto = filas.map(textoFila).join('\n');
  const out = { banco: /security/i.test(titulo + texto) ? 'Banco Security' : (titulo || 'Banco'), tarjeta: null, periodo: null, movimientos: [], omitidos: [] };
  const mt = texto.match(/\*{4}\s*(\d{4})/);
  if (mt) out.tarjeta = mt[1];
  const mp = texto.match(/Per[ií]odo facturado\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})/);
  if (mp) out.periodo = { desde: isoDe(mp[1]), hasta: isoDe(mp[2]) };
  const me = texto.match(/Estado de Cuenta[^\n]*?al\s+(\d{2}\/\d{2}\/\d{4})/i);
  out.fechaEstado = me ? isoDe(me[1]) : out.periodo?.hasta || null;

  let seccion = null, ultimo = null;
  for (const fila of filas) {
    const t = textoFila(fila);
    const sec = t.match(/^\s*(\d)\.\s*([A-ZÁÉÍÓÚÑ ,]+)/);
    if (sec && fila[0].x < 120) { seccion = +sec[1]; ultimo = null; continue; }
    if (/Informaci[oó]n de pago|COMPROBANTE DE PAGO/i.test(t)) { seccion = null; ultimo = null; continue; }
    if (!seccion) continue;

    const iFecha = fila.findIndex(i => reFecha.test(i.s));
    const esMovimiento = iFecha >= 0 && reRef.test(fila[iFecha + 1]?.s || '');
    if (!esMovimiento) {
      // continuación de la descripción del movimiento anterior (misma columna)
      if (ultimo && fila.every(i => Math.abs(i.x - ultimo.xDesc) < 8 || i.x > ultimo.xDesc) && !fila.some(i => reDinero.test(i.s))) {
        ultimo.descripcion = `${ultimo.descripcion} ${t}`.trim();
      }
      continue;
    }
    const resto = fila.slice(iFecha + 2);
    const desc = [], dinero = [], cuota = [];
    for (const it of resto) {
      if (reDinero.test(it.s)) dinero.push(parseMonto(it.s.replace('$', '')));
      else if (dinero.length && /^[\d\s/]+$/.test(it.s)) cuota.push(it.s);
      else if (!dinero.length) desc.push(it);
    }
    const nums = cuota.join(' ').match(/\d{2}/g) || [];
    const mov = {
      seccion, fecha: isoDe(fila[iFecha].s), ref: fila[iFecha + 1].s,
      descripcion: desc.map(i => i.s).join(' '), xDesc: desc[0]?.x ?? 0,
      lugar: fila.slice(0, iFecha).map(i => i.s).join(' '),
      montoOperacion: dinero[0], montoTotal: dinero[1] ?? dinero[0], valorCuota: dinero[dinero.length - 1],
      cuota: nums.length >= 2 ? { n: +nums[0], de: +nums[1] } : null,
    };
    ultimo = mov;
    out.movimientos.push(mov);
  }

  // Clasificación: qué se registra como gasto y por cuánto
  const desde = out.periodo?.desde, hasta = out.periodo?.hasta || out.fechaEstado;
  const gastos = [];
  for (const m of out.movimientos) {
    delete m.xDesc;
    m.descripcion = m.descripcion.replace(/\s+/g, ' ').trim();
    if (m.seccion === 4) { out.omitidos.push({ ...m, motivo: 'Cuota futura (aún no se cobra)' }); continue; }
    if (m.valorCuota <= 0 || /^(MONTO CANCELADO|PAGO\b|ABONO\b|NOTA DE CR[EÉ]DITO|REVERSA)/i.test(m.descripcion)) { out.omitidos.push({ ...m, motivo: 'Pago o abono a la tarjeta' }); continue; }
    if (m.cuota && m.cuota.n === 0) { out.omitidos.push({ ...m, motivo: 'Cuota futura (aún no se cobra)' }); continue; }
    const enCuotas = m.cuota && m.cuota.de > 1;
    const dentro = desde && m.fecha >= desde && m.fecha <= hasta;
    gastos.push({
      ...m,
      tipo: m.seccion === 3 ? 'cargo' : enCuotas ? 'cuota' : 'compra',
      monto: m.valorCuota,
      // las cuotas de compras anteriores se registran en el cierre del período en que se pagan
      fechaGasto: enCuotas && !dentro ? hasta : m.fecha,
      comercio: m.seccion === 3 ? 'Banco · ' + limpiarComercio(m.descripcion) : limpiarComercio(m.descripcion),
    });
  }
  out.gastos = gastos;
  out.total = gastos.reduce((s, g) => s + g.monto, 0);
  return out;
}

export async function leerCartola(file) {
  const datos = new Uint8Array(await file.arrayBuffer());
  return interpretarCartola(await filasDePdf(datos));
}
