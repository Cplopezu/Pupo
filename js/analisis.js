// Motor analítico: períodos, agregaciones y descomposición de variaciones.
import { iso, toDate, addDays, diffDays, diasDelMes, mesLargo, fechaLarga } from './util.js';

export function rango(p, ref = new Date()) {
  const y = ref.getFullYear(), m = ref.getMonth(), d = ref.getDate();
  const hoyS = iso(ref);
  let r;
  switch (p) {
    case 'mesant': {
      const pm = new Date(y, m - 1, 1), ppm = new Date(y, m - 2, 1);
      r = {
        desde: iso(pm), hasta: iso(new Date(y, m, 0)),
        prevDesde: iso(ppm), prevHasta: iso(new Date(y, m - 1, 0)),
        label: mesLargo(pm.getFullYear(), pm.getMonth()), prevLabel: mesLargo(ppm.getFullYear(), ppm.getMonth()),
        mensual: true, cerrado: true,
      };
      break;
    }
    case '3m': {
      const desde = addDays(hoyS, -89);
      r = { desde, hasta: hoyS, prevDesde: addDays(desde, -90), prevHasta: addDays(desde, -1), label: 'Últimos 90 días', prevLabel: '90 días previos' };
      break;
    }
    case 'ytd': {
      const pd = Math.min(d, diasDelMes(y - 1, m));
      r = { desde: `${y}-01-01`, hasta: hoyS, prevDesde: `${y - 1}-01-01`, prevHasta: iso(new Date(y - 1, m, pd)), label: `Año ${y} a la fecha`, prevLabel: `Mismo tramo ${y - 1}` };
      break;
    }
    case '12m': {
      const desde = addDays(hoyS, -364);
      r = { desde, hasta: hoyS, prevDesde: addDays(desde, -365), prevHasta: addDays(desde, -1), label: 'Últimos 12 meses', prevLabel: '12 meses previos' };
      break;
    }
    default: { // mes actual, comparado contra los mismos días del mes anterior
      const pm = new Date(y, m - 1, 1);
      const pd = Math.min(d, diasDelMes(pm.getFullYear(), pm.getMonth()));
      r = {
        desde: iso(new Date(y, m, 1)), hasta: hoyS, fin: iso(new Date(y, m + 1, 0)),
        prevDesde: iso(pm), prevHasta: iso(new Date(pm.getFullYear(), pm.getMonth(), pd)),
        label: mesLargo(y, m), prevLabel: `mismos días de ${mesLargo(pm.getFullYear(), pm.getMonth())}`,
        mensual: true, enCurso: true,
      };
    }
  }
  r.p = p;
  r.dias = diffDays(r.desde, r.hasta) + 1;
  r.prevDias = diffDays(r.prevDesde, r.prevHasta) + 1;
  r.rotulo = `${fechaLarga(r.desde)} → ${fechaLarga(r.hasta)}`;
  return r;
}

export const enRango = (g, desde, hasta) => g.fecha >= desde && g.fecha <= hasta;
export const total = list => list.reduce((s, g) => s + g.monto, 0);
export const varPct = (a, b) => b > 0 ? (a - b) / b * 100 : (a > 0 ? null : 0);

export function agrupar(list, keyFn) {
  const m = new Map();
  for (const g of list) {
    const k = keyFn(g);
    if (!m.has(k)) m.set(k, { clave: k, total: 0, n: 0, items: [] });
    const e = m.get(k);
    e.total += g.monto; e.n++; e.items.push(g);
  }
  return [...m.values()].sort((a, b) => b.total - a.total);
}

export function serieDiaria(list, desde, hasta) {
  const n = diffDays(desde, hasta) + 1;
  const arr = new Array(Math.max(0, n)).fill(0);
  for (const g of list) {
    const i = diffDays(desde, g.fecha);
    if (i >= 0 && i < n) arr[i] += g.monto;
  }
  return arr;
}

export const acumular = arr => { let s = 0; return arr.map(v => (s += v)); };

// Agrupa una serie diaria en semanas o meses para períodos largos.
export function serieAgrupada(list, desde, hasta) {
  const dias = diffDays(desde, hasta) + 1;
  if (dias <= 62) {
    return serieDiaria(list, desde, hasta).map((v, i) => {
      const f = addDays(desde, i);
      return { desde: f, hasta: f, value: v };
    }).map(b => ({ ...b, gran: 'día' }));
  }
  if (dias <= 120) {
    const out = [];
    for (let i = 0; i < dias; i += 7) {
      const a = addDays(desde, i), b = addDays(desde, Math.min(dias - 1, i + 6));
      out.push({ desde: a, hasta: b, value: total(list.filter(g => enRango(g, a, b))), gran: 'semana' });
    }
    return out;
  }
  const out = [];
  let d = toDate(desde);
  d = new Date(d.getFullYear(), d.getMonth(), 1);
  while (iso(d) <= hasta) {
    const a = iso(d) < desde ? desde : iso(d);
    const finMes = iso(new Date(d.getFullYear(), d.getMonth() + 1, 0));
    const b = finMes > hasta ? hasta : finMes;
    out.push({ desde: a, hasta: b, value: total(list.filter(g => enRango(g, a, b))), gran: 'mes' });
    d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  }
  return out;
}

// Descomposición de la variación total por una dimensión (categoría, comercio…)
export function descomponer(actual, anterior, keyFn) {
  const a = new Map(agrupar(actual, keyFn).map(e => [e.clave, e]));
  const b = new Map(agrupar(anterior, keyFn).map(e => [e.clave, e]));
  const totB = total(anterior);
  const deltaTotal = total(actual) - totB;
  const claves = new Set([...a.keys(), ...b.keys()]);
  return [...claves].map(k => {
    const va = a.get(k)?.total || 0, vb = b.get(k)?.total || 0;
    const delta = va - vb;
    return {
      clave: k, actual: va, anterior: vb, delta,
      var: varPct(va, vb),
      aporte: totB > 0 ? delta / totB * 100 : null,           // puntos porcentuales de la variación total
      peso: deltaTotal !== 0 ? delta / deltaTotal * 100 : null, // % de la variación explicado
    };
  }).sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
}

export function porDiaSemana(list) {
  const arr = Array.from({ length: 7 }, () => ({ total: 0, n: 0 }));
  for (const g of list) { const d = toDate(g.fecha).getDay(); arr[d].total += g.monto; arr[d].n++; }
  return arr;
}

export const TRAMOS = [
  { hasta: 5000, label: '< 5 mil' },
  { hasta: 15000, label: '5–15 mil' },
  { hasta: 30000, label: '15–30 mil' },
  { hasta: 60000, label: '30–60 mil' },
  { hasta: 120000, label: '60–120 mil' },
  { hasta: Infinity, label: '> 120 mil' },
];
export function histogramaTicket(list) {
  const out = TRAMOS.map(t => ({ ...t, n: 0, total: 0 }));
  for (const g of list) { const t = out.find(x => g.monto < x.hasta); t.n++; t.total += g.monto; }
  return out;
}

export function mediana(nums) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
