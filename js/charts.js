// Gráficos SVG livianos con tooltip y crosshair. Sin dependencias.
import { esc } from './util.js';

const NS = 'http://www.w3.org/2000/svg';
const M = { t: 12, r: 12, b: 26, l: 56 };

function niceMax(v) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

function frame(el, height) {
  el.innerHTML = '';
  el.style.minHeight = height + 'px';
  const W = Math.max(280, el.clientWidth);
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${height}`);
  svg.setAttribute('height', height);
  el.appendChild(svg);
  const tip = document.createElement('div');
  tip.className = 'tip';
  el.appendChild(tip);
  return { svg, tip, W, H: height };
}

function yAxis(svg, W, H, max, fmtAxis) {
  const g = document.createElementNS(NS, 'g');
  let html = '<g class="grid">';
  const ticks = 4;
  for (let i = 0; i <= ticks; i++) {
    const y = M.t + (H - M.t - M.b) * (1 - i / ticks);
    html += `<line x1="${M.l}" x2="${W - M.r}" y1="${y}" y2="${y}"/>`;
  }
  html += '</g><g class="axis">';
  for (let i = 0; i <= ticks; i++) {
    const y = M.t + (H - M.t - M.b) * (1 - i / ticks);
    html += `<text x="${M.l - 8}" y="${y + 4}" text-anchor="end">${esc(fmtAxis(max * i / ticks))}</text>`;
  }
  html += '</g>';
  g.innerHTML = html;
  svg.appendChild(g);
}

function xLabels(svg, W, H, labels, xOf, maxLabels) {
  const g = document.createElementNS(NS, 'g');
  g.setAttribute('class', 'axis');
  const n = labels.length;
  const step = Math.max(1, Math.ceil(n / maxLabels));
  let html = '';
  for (let i = 0; i < n; i += step) {
    html += `<text x="${xOf(i)}" y="${H - 6}" text-anchor="middle">${esc(labels[i])}</text>`;
  }
  g.innerHTML = html;
  svg.appendChild(g);
}

function placeTip(el, tip, x, y) {
  const w = tip.offsetWidth, h = tip.offsetHeight, W = el.clientWidth;
  let left = x + 14;
  if (left + w > W) left = x - w - 14;
  tip.style.left = Math.max(0, left) + 'px';
  tip.style.top = Math.max(0, y - h / 2) + 'px';
}

/**
 * Líneas sobre un mismo eje (nunca doble eje).
 * series: [{ name, color, values:[...], dashed }], labels: etiquetas eje X
 */
export function lineChart(el, { series, labels, fmt, fmtAxis, height = 260, area = true, tipTitle }) {
  const { svg, tip, W, H } = frame(el, height);
  const n = labels.length;
  const max = niceMax(Math.max(1, ...series.flatMap(s => s.values.filter(v => v != null))));
  const xOf = i => M.l + (n <= 1 ? 0 : (W - M.l - M.r) * i / (n - 1));
  const yOf = v => M.t + (H - M.t - M.b) * (1 - v / max);
  yAxis(svg, W, H, max, fmtAxis || fmt);
  xLabels(svg, W, H, labels, xOf, Math.floor(W / 70));

  const base = document.createElementNS(NS, 'line');
  base.setAttribute('class', 'baseline');
  Object.entries({ x1: M.l, x2: W - M.r, y1: H - M.b, y2: H - M.b }).forEach(([k, v]) => base.setAttribute(k, v));
  svg.appendChild(base);

  series.forEach((s, si) => {
    const pts = s.values.map((v, i) => v == null ? null : [xOf(i), yOf(v)]).filter(Boolean);
    if (!pts.length) return;
    const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join('');
    if (area && si === 0) {
      const gid = 'g' + Math.random().toString(36).slice(2);
      const defs = document.createElementNS(NS, 'defs');
      defs.innerHTML = `<linearGradient id="${gid}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${s.color}" stop-opacity=".28"/><stop offset="1" stop-color="${s.color}" stop-opacity="0"/></linearGradient>`;
      svg.appendChild(defs);
      const a = document.createElementNS(NS, 'path');
      a.setAttribute('d', d + `L${pts[pts.length - 1][0]},${H - M.b}L${pts[0][0]},${H - M.b}Z`);
      a.setAttribute('fill', `url(#${gid})`);
      svg.appendChild(a);
    }
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', s.color);
    p.setAttribute('stroke-width', '2');
    p.setAttribute('stroke-linejoin', 'round');
    if (s.dashed) p.setAttribute('stroke-dasharray', '5 4');
    svg.appendChild(p);
    // punto final con anillo de superficie
    const last = pts[pts.length - 1];
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('cx', last[0]); c.setAttribute('cy', last[1]); c.setAttribute('r', 4);
    c.setAttribute('fill', s.color); c.setAttribute('stroke', '#131c27'); c.setAttribute('stroke-width', 2);
    svg.appendChild(c);
  });

  // crosshair + tooltip
  const xh = document.createElementNS(NS, 'line');
  xh.setAttribute('class', 'xhair'); xh.setAttribute('y1', M.t); xh.setAttribute('y2', H - M.b); xh.style.display = 'none';
  svg.appendChild(xh);
  const dots = series.map(s => {
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('r', 4); c.setAttribute('fill', s.color); c.setAttribute('stroke', '#131c27'); c.setAttribute('stroke-width', 2);
    c.style.display = 'none'; svg.appendChild(c); return c;
  });
  const hit = document.createElementNS(NS, 'rect');
  Object.entries({ x: M.l, y: M.t, width: W - M.l - M.r, height: H - M.t - M.b, fill: 'transparent' }).forEach(([k, v]) => hit.setAttribute(k, v));
  svg.appendChild(hit);

  const move = ev => {
    const r = svg.getBoundingClientRect();
    const x = (ev.clientX - r.left) * (W / r.width);
    const i = Math.max(0, Math.min(n - 1, Math.round((x - M.l) / ((W - M.l - M.r) / Math.max(1, n - 1)))));
    const px = xOf(i);
    xh.setAttribute('x1', px); xh.setAttribute('x2', px); xh.style.display = '';
    let rows = '';
    series.forEach((s, si) => {
      const v = s.values[i];
      if (v == null) { dots[si].style.display = 'none'; return; }
      dots[si].setAttribute('cx', px); dots[si].setAttribute('cy', yOf(v)); dots[si].style.display = '';
      rows += `<div class="t-r"><span><i style="background:${s.color}"></i>${esc(s.name)}</span><b>${esc(fmt(v))}</b></div>`;
    });
    tip.innerHTML = `<div class="t-h">${esc(tipTitle ? tipTitle(i) : labels[i])}</div>${rows}`;
    tip.classList.add('is-on');
    placeTip(el, tip, px * (r.width / W), (ev.clientY - r.top));
  };
  hit.addEventListener('pointermove', move);
  hit.addEventListener('pointerdown', move);
  hit.addEventListener('pointerleave', () => {
    tip.classList.remove('is-on'); xh.style.display = 'none'; dots.forEach(d => d.style.display = 'none');
  });
}

/**
 * Barras verticales. bars: [{ label, value, color, tip }], ref: línea de referencia {value,label}
 */
export function barChart(el, { bars, fmt, fmtAxis, height = 220, ref, onClick, maxLabels }) {
  const { svg, tip, W, H } = frame(el, height);
  const n = bars.length || 1;
  const max = niceMax(Math.max(1, ref?.value || 0, ...bars.map(b => b.value)));
  const band = (W - M.l - M.r) / n;
  const gap = Math.min(4, band * 0.25);
  const bw = Math.max(1, band - gap);
  const xOf = i => M.l + band * i + band / 2;
  const yOf = v => M.t + (H - M.t - M.b) * (1 - v / max);
  yAxis(svg, W, H, max, fmtAxis || fmt);
  xLabels(svg, W, H, bars.map(b => b.label), xOf, maxLabels || Math.floor(W / 64));

  const g = document.createElementNS(NS, 'g');
  bars.forEach((b, i) => {
    const y = yOf(b.value), h = Math.max(0, H - M.b - y);
    const x = M.l + band * i + gap / 2;
    const r = Math.min(4, bw / 2, h);
    const p = document.createElementNS(NS, 'path');
    // esquinas superiores redondeadas, ancladas a la línea base
    p.setAttribute('d', `M${x},${H - M.b}V${y + r}Q${x},${y} ${x + r},${y}H${x + bw - r}Q${x + bw},${y} ${x + bw},${y + r}V${H - M.b}Z`);
    p.setAttribute('fill', b.color || 'var(--c1)');
    p.setAttribute('class', 'bar');
    g.appendChild(p);
    // zona de impacto más grande que la barra
    const hit = document.createElementNS(NS, 'rect');
    Object.entries({ x: M.l + band * i, y: M.t, width: band, height: H - M.t - M.b, fill: 'transparent' }).forEach(([k, v]) => hit.setAttribute(k, v));
    if (onClick) hit.style.cursor = 'pointer';
    hit.addEventListener('pointerenter', ev => {
      p.classList.add('is-hover');
      tip.innerHTML = `<div class="t-h">${esc(b.tipTitle || b.label)}</div><div class="t-r"><span>${esc(b.tipLabel || 'Gasto')}</span><b>${esc(fmt(b.value))}</b></div>${b.tipExtra || ''}`;
      tip.classList.add('is-on');
      const rr = svg.getBoundingClientRect();
      placeTip(el, tip, xOf(i) * (rr.width / W), ev.clientY - rr.top);
    });
    hit.addEventListener('pointerleave', () => { p.classList.remove('is-hover'); tip.classList.remove('is-on'); });
    if (onClick) hit.addEventListener('click', e => { e.stopPropagation(); onClick(i, b); });
    g.appendChild(hit);
  });
  svg.appendChild(g);

  const base = document.createElementNS(NS, 'line');
  base.setAttribute('class', 'baseline');
  Object.entries({ x1: M.l, x2: W - M.r, y1: H - M.b, y2: H - M.b }).forEach(([k, v]) => base.setAttribute(k, v));
  svg.appendChild(base);

  if (ref && ref.value > 0) {
    const y = yOf(ref.value);
    const l = document.createElementNS(NS, 'line');
    l.setAttribute('class', 'ref');
    Object.entries({ x1: M.l, x2: W - M.r, y1: y, y2: y }).forEach(([k, v]) => l.setAttribute(k, v));
    l.style.pointerEvents = 'none';
    svg.appendChild(l);
    const t = document.createElementNS(NS, 'text');
    t.setAttribute('class', 'ref-label'); t.setAttribute('x', W - M.r); t.setAttribute('y', y - 5); t.setAttribute('text-anchor', 'end');
    t.textContent = ref.label;
    svg.appendChild(t);
  }
}

export function sparkline(values, color, w = 160, h = 28) {
  if (!values.length) return '';
  const max = Math.max(1, ...values), n = values.length;
  const pts = values.map((v, i) => `${(n === 1 ? w : (w * i / (n - 1))).toFixed(1)},${(h - 2 - (h - 4) * v / max).toFixed(1)}`);
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" width="100%" height="${h}" aria-hidden="true">
    <polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>`;
}
