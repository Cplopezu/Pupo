// Utilidades: formato, fechas, imágenes, hash.
export const MONEDA = 'CLP';

const fmtMoneda = new Intl.NumberFormat('es-CL', { style: 'currency', currency: MONEDA, maximumFractionDigits: 0 });
const fmtCompacto = new Intl.NumberFormat('es-CL', { notation: 'compact', maximumFractionDigits: 1 });
const fmtNum = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 1 });

export const $ = n => fmtMoneda.format(Math.round(n || 0));
export const $k = n => '$' + fmtCompacto.format(Math.round(n || 0));
export const num = n => fmtNum.format(n || 0);
export const pct = (n, dec = 1) => (n == null || !isFinite(n)) ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(dec).replace('.', ',')}%`;
export const pctPlano = (n, dec = 0) => (n == null || !isFinite(n)) ? '—' : `${n.toFixed(dec).replace('.', ',')}%`;

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Interpreta montos en formato chileno: "12.990", "$ 1.234.567", "12990,50"
export function parseMonto(txt) {
  if (typeof txt === 'number') return txt;
  let s = String(txt || '').replace(/[^\d.,-]/g, '');
  if (!s) return NaN;
  if (s.includes(',') && s.lastIndexOf(',') > s.lastIndexOf('.')) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (/\.\d{3}(?!\d)/.test(s)) {
    s = s.replace(/\./g, '').replace(/,/g, '');
  } else {
    s = s.replace(/,/g, '');
  }
  return parseFloat(s);
}

/* ---------- Fechas (cadenas ISO YYYY-MM-DD, sin zona horaria) ---------- */
export function iso(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
export function toDate(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
export function addDays(s, n) { const d = toDate(s); d.setDate(d.getDate() + n); return iso(d); }
export function diffDays(a, b) { return Math.round((toDate(b) - toDate(a)) / 86400000); }
export function hoy() { return iso(new Date()); }
export function diasDelMes(y, m) { return new Date(y, m + 1, 0).getDate(); }

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MESES_L = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
export const fechaCorta = s => { const d = toDate(s); return `${String(d.getDate()).padStart(2, '0')} ${MESES[d.getMonth()]}`; };
export const fechaLarga = s => { const d = toDate(s); return `${d.getDate()} ${MESES[d.getMonth()]} ${d.getFullYear()}`; };
export const mesLargo = (y, m) => `${MESES_L[m]} ${y}`;
export const mesCorto = s => { const d = toDate(s); return `${MESES[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`; };
export const fechaHora = ts => new Date(ts).toLocaleString('es-CL', { dateStyle: 'medium', timeStyle: 'short' });

/* ---------- Imágenes ---------- */
export async function comprimirImagen(file, maxLado = 1600, calidad = 0.82) {
  const bmp = await cargarBitmap(file);
  const escala = Math.min(1, maxLado / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * escala), h = Math.round(bmp.height * escala);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', calidad));
  return { blob, w, h };
}

async function cargarBitmap(file) {
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* fallback */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally { URL.revokeObjectURL(url); }
}

export async function sha256(blob) {
  if (!crypto?.subtle) return null;
  const buf = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export const blobToDataURL = blob => new Promise((res, rej) => {
  const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob);
});
export async function dataURLToBlob(url) { return (await fetch(url)).blob(); }

export function uid() {
  return (crypto.randomUUID?.() || (Date.now().toString(36) + Math.random().toString(36).slice(2)));
}

export function descargar(nombre, contenido, tipo) {
  const blob = contenido instanceof Blob ? contenido : new Blob([contenido], { type: tipo });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nombre;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
