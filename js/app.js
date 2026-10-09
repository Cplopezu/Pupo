import { db, getAjuste, setAjuste, pedirPersistencia, estimarUso } from './db.js';
import {
  $, $k, num, pct, pctPlano, esc, parseMonto, iso, toDate, addDays, diffDays, hoy, diasDelMes,
  DIAS, fechaCorta, fechaLarga, mesCorto, mesLargo, fechaHora, comprimirImagen, sha256,
  blobToDataURL, dataURLToBlob, uid, descargar, guardarArchivo,
} from './util.js';
import {
  rango, enRango, total, varPct, agrupar, serieDiaria, acumular, serieAgrupada, descomponer,
  porDiaSemana, histogramaTicket, mediana,
} from './analisis.js';
import { lineChart, barChart, sparkline } from './charts.js';
import { leerBoleta } from './ocr.js';
import { leerCartola } from './cartola.js';
import {
  iniciarNube, nubeEstado, nubeEmail, alCambiar, sincronizar, entrar, registrarse, salir, unirseALibro,
  renombrarLibro, guardarConfigNube, configNube, bajarFoto, contarPendientesNube,
} from './nube.js';

/* ============================================================
   Configuración
   ============================================================ */
// Las 4 categorías del método Kakebo
const CATEGORIAS_BASE = ['Supervivencia', 'Ocio y vicio', 'Cultura', 'Extras'];
const KAKEBO_DESC = {
  'Supervivencia': 'Lo necesario: supermercado, transporte, salud, cuentas, arriendo',
  'Ocio y vicio': 'Lo prescindible: restaurantes, cafés, salidas, suscripciones',
  'Cultura': 'Lo que te desarrolla: libros, cursos, teatro, museos',
  'Extras': 'Lo imprevisto: regalos, reparaciones, multas, compras puntuales',
};
// Equivalencia desde las categorías de la primera versión
const MIGRAR_CAT = { Supermercado: 'Supervivencia', Transporte: 'Supervivencia', Hogar: 'Supervivencia', Salud: 'Supervivencia', Servicios: 'Supervivencia', Restaurantes: 'Ocio y vicio', Ocio: 'Ocio y vicio', Otros: 'Extras' };
// Palabras clave para sugerir la categoría según el comercio o el texto de la boleta
const PISTAS_CAT = [
  ['Extras', /^banco ·|equifax|h&m|mercado ?libre|merpago\*melimas|regalo/i],
  ['Cultura', /corpcult|corporaci[oó]n cultural|l[aá]piz l[oó]pez|librer|libro|antartica|antártica|buscalibre|teatro|museo|curso|coursera|udemy|platzi|universidad|diplomado|revista|kindle|audible|concierto|opera|ópera|biblioteca/i],
  ['Ocio y vicio', /cafeter|coffee|cinnabon|krispy|snack|brekkie|cin[eé]polis|burger king|sushi|empanad|helader|restaur|caf[eé]|starbucks|juan valdez|\bbar\b|pub|botiller|cerveza|pizza|sushi|burger|mcdonald|doggis|juan maestro|kfc|cinemark|hoyts|\bcine|netflix|spotify|disney|hbo|prime video|ticket|rappi|pedidos ?ya|uber ?eats|casino|cigarr|tabaco|helad|pasteler/i],
  ['Extras', /regalo|ferreter|sodimac|\beasy\b|homecenter|ikea|reparaci|taller|mec[aá]nic|veterinar|multa|notar|correos|falabella|paris|ripley|hites|la polar|ropa|zapat/i],
  ['Supervivencia', /red movilidad|transporte p[uú]blico|estacionamiento|autopista|dividendo|hipotec|comunidadfeliz|gastos comunes|isapre|masvida|internet|seguro|municipal|\bsii\b|tesorer[ií]a|\btgr\b|school|colegio|odontolog|dental|cl[ií]nica|farmacia|feria|manantial|minimarket|mimarket|supermerc|jumbo|l[ií]der|unimarc|tottus|santa isabel|acuenta|ekono|mayorista|farmacia|cruz verde|salcobrand|ahumada|copec|shell|petrobras|aramco|enex|metro|\bbip\b|uber|cabify|didi|autopista|\btag\b|enel|aguas|metrogas|gasco|abastible|lipigas|movistar|entel|\bwom\b|\bvtr\b|claro|cl[ií]nica|isapre|fonasa|m[eé]dic|dental|panader|carnicer|verduler|almac[eé]n|arriendo|gastos comunes|colegio|jard[ií]n/i],
];
function sugerirCategoria(texto) {
  const t = String(texto || '');
  for (const [cat, re] of PISTAS_CAT) if (re.test(t)) return cat;
  return null;
}
const MEDIOS = ['Tarjeta de crédito', 'Tarjeta de débito', 'Efectivo', 'Transferencia', 'Rendición empresa'];
const PALETA = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
const GRIS = '#6f8299';
const ACCENT = '#4cc2ff';
const CAMPOS = { monto: 'Monto', fecha: 'Fecha', comercio: 'Comercio', categoria: 'Categoría', medioPago: 'Medio de pago', documento: 'Documento', folio: 'Folio', rut: 'RUT', notas: 'Notas' };

const S = {
  gastos: [],
  categorias: CATEGORIAS_BASE,
  presupuestos: {},
  periodo: 'mes',
  editId: null,
  foto: null,          // { blob, hash, w, h, url }
};

const el = id => document.getElementById(id);
const colorCat = c => { const i = S.categorias.indexOf(c); return i >= 0 && i < PALETA.length ? PALETA[i] : GRIS; };
const activos = () => S.gastos.filter(g => !g.anulado);
const folio = g => 'G-' + String(g.seq || 0).padStart(5, '0');
const deCartola = g => g.origen?.tipo === 'cartola' || !!g.conciliado;
const tieneRespaldo = g => !!g.imagenId || deCartola(g);

function deltaChip(v, { invertir = false } = {}) {
  if (v == null || !isFinite(v)) return '<span class="delta flat">nuevo</span>';
  if (Math.abs(v) < 0.05) return '<span class="delta flat">0,0%</span>';
  const malo = invertir ? v < 0 : v > 0;
  return `<span class="delta ${malo ? 'pos' : 'neg'}">${v > 0 ? '▲' : '▼'} ${pct(v).replace('+', '')}</span>`;
}

// Confirmación dentro de la página. Devuelve el texto ingresado ('' si no hay campo) o null si se cancela.
function dialogo({ titulo, texto, campo, ok = 'Aceptar', peligro = false }) {
  return new Promise(resolve => {
    const fondo = el('dialogo');
    el('dlg-titulo').textContent = titulo;
    el('dlg-texto').textContent = texto || '';
    const wrap = el('dlg-campo-wrap'), input = el('dlg-campo');
    wrap.hidden = !campo;
    el('dlg-campo-label').textContent = campo || '';
    input.value = '';
    const btnOk = el('dlg-ok');
    btnOk.textContent = ok;
    btnOk.className = peligro ? 'btn-primary btn-danger' : 'btn-primary';
    fondo.hidden = false;
    (campo ? input : btnOk).focus();
    const fin = v => { fondo.hidden = true; btnOk.onclick = el('dlg-cancelar').onclick = fondo.onkeydown = null; resolve(v); };
    btnOk.onclick = () => fin(campo ? input.value.trim() : '');
    el('dlg-cancelar').onclick = () => fin(null);
    fondo.onkeydown = e => { if (e.key === 'Escape') { e.stopPropagation(); fin(null); } if (e.key === 'Enter' && campo) fin(input.value.trim()); };
  });
}

function toast(msg, ms = 2600) {
  const t = el('toast');
  t.textContent = msg;
  t.classList.add('is-on');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('is-on'), ms);
}

/* ============================================================
   Carga inicial
   ============================================================ */
async function cargar() {
  S.gastos = await db.all('gastos');
  S.categorias = CATEGORIAS_BASE;
  S.presupuestos = await getAjuste('presupuestos', {});
  await migrarKakebo();
}

// Convierte registros y presupuestos de categorías antiguas a Kakebo, dejando constancia en la bitácora.
async function migrarKakebo() {
  for (const g of S.gastos) {
    if (CATEGORIAS_BASE.includes(g.categoria)) continue;
    const nueva = MIGRAR_CAT[g.categoria] || sugerirCategoria(g.comercio) || 'Extras';
    const antes = g.categoria;
    g.categoria = nueva;
    g.historial = [...(g.historial || []), { ts: Date.now(), accion: 'Reclasificado a Kakebo', cambios: [{ campo: 'Categoría', antes, despues: nueva }] }];
    await db.put('gastos', g);
  }
  const claves = Object.keys(S.presupuestos);
  if (claves.some(k => !CATEGORIAS_BASE.includes(k))) {
    const p = {};
    for (const k of claves) { const c = CATEGORIAS_BASE.includes(k) ? k : (MIGRAR_CAT[k] || 'Extras'); p[c] = (p[c] || 0) + (+S.presupuestos[k] || 0); }
    S.presupuestos = p;
    await setAjuste('presupuestos', p);
  }
}

async function init() {
  await cargar();
  S.persistente = await pedirPersistencia();
  revisarAlmacen();
  poblarSelects();
  bindNav();
  bindForm();
  bindLibro();
  bindImportar();
  bindAjustes();
  bindDrawer();
  bindDelegados();
  reloj();
  render();
  bindNube();
  iniciarNube().then(() => sincronizarYRefrescar());
  let ancho = window.innerWidth;
  window.addEventListener('resize', () => {
    clearTimeout(init._r);
    init._r = setTimeout(() => { if (window.innerWidth !== ancho) { ancho = window.innerWidth; render(); } }, 200);
  });
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

/* ============================================================
   Protección de datos: dónde se está usando la app y respaldos
   ============================================================ */
const ua = navigator.userAgent;
const esIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const instalada = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
const dentroDeOtraApp = /FBAN|FBAV|Instagram|WhatsApp|GSA\/|Line\/|LinkedInApp|Twitter/i.test(ua);

async function revisarAlmacen() {
  const aviso = el('aviso-almacen');
  const reales = S.gastos.filter(g => !g.demo).length;
  const ultimo = await getAjuste('ultimoRespaldo', null);
  const dias = ultimo ? Math.floor((Date.now() - ultimo) / 86400000) : null;
  let html = '';
  if (dentroDeOtraApp) {
    html = '<b>Está abriendo Pupo dentro de otra aplicación</b> (WhatsApp, correo, redes). Lo que registre aquí se pierde. Ábrala en Safari o Chrome y agréguela a la pantalla de inicio.';
  } else if (esIOS && !instalada() && !nubeEstado().email) {
    html = '<b>Está usando Pupo desde el navegador.</b> En iPhone, estos datos se guardan aparte de la app de la pantalla de inicio y Safari puede borrarlos tras 7 días sin uso. Toque <b>Compartir → Agregar a pantalla de inicio</b> y use siempre ese ícono.';
  } else if (nubeEstado().email && nubeEstado().fase !== 'error') {
    html = '';
  } else if (reales >= 5 && (dias == null || dias >= 14)) {
    html = `<b>${dias == null ? 'Aún no tiene un respaldo.' : `Su último respaldo es de hace ${dias} días.`}</b> Sus ${reales} gastos viven solo en este dispositivo. Descargue un respaldo en Ajustes.`;
  }
  aviso.hidden = !html;
  if (html) aviso.innerHTML = `<span class="ico">⚠</span><span class="txt">${html}</span>${reales >= 5 && !dentroDeOtraApp ? '<button class="btn-ghost" data-goto-respaldo>Respaldar</button>' : ''}`;
  aviso.querySelector('[data-goto-respaldo]')?.addEventListener('click', exportarJSON);
}

/* ============================================================
   Nube: indicador, sincronización automática y panel de cuenta
   ============================================================ */
async function sincronizarYRefrescar() {
  const res = await sincronizar();
  if (res.cambios) {
    await cargar();
    actualizarDatalist();
    render();
    if (pila.length) pintarDrawer();
  }
  return res;
}

function programarSync(ms = 1500) {
  contarPendientesNube();
  clearTimeout(programarSync._t);
  programarSync._t = setTimeout(sincronizarYRefrescar, ms);
}

function pintarIndicador(e) {
  const b = el('nube-ind');
  let txt = '● Solo en este equipo', cls = '';
  if (e.fase === 'sincronizando') { txt = '↻ Sincronizando…'; cls = 'sync'; }
  else if (e.fase === 'conectada') { txt = e.pendientes ? `☁ ${e.pendientes} por subir` : '☁ Sincronizado'; cls = e.pendientes ? 'warn' : 'ok'; }
  else if (e.fase === 'sin-sesion') { txt = '☁ Iniciar sesión'; cls = 'warn'; }
  else if (e.fase === 'error') { txt = e.email ? '⚠ Sin sincronizar' : '⚠ Nube no disponible'; cls = 'warn'; }
  b.textContent = txt;
  b.className = 'nube-ind ' + cls;
  b.title = e.error || (e.ultima ? `Última sincronización: ${fechaHora(e.ultima)}` : 'Estado de la nube');
}

function bindNube() {
  alCambiar(e => {
    pintarIndicador(e);
    revisarAlmacen();
    if (el('view-ajustes').classList.contains('is-active') && !el('panel-nube').contains(document.activeElement)) renderNube();
  });
  pintarIndicador(nubeEstado());
  el('nube-ind').addEventListener('click', () => irA('ajustes'));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') programarSync(300); });
  window.addEventListener('online', () => programarSync(300));
  setInterval(() => { if (document.visibilityState === 'visible') sincronizarYRefrescar(); }, 120000);
}

let nubeMsg = null; // { tipo: 'ok'|'err', texto }
async function renderNube() {
  const e = nubeEstado();
  const cfg = await configNube();
  const msg = nubeMsg ? `<div class="nube-msg ${nubeMsg.tipo}">${esc(nubeMsg.texto)}</div>` : '';
  let html = '';
  el('nube-estado-txt').textContent = e.fase === 'conectada' ? (e.ultima ? `Sincronizado ${fechaHora(e.ultima)}` : 'Conectado') : '';
  if (!cfg) {
    html = `<div class="nube-grid">
      <div class="nube-box">
        <p class="muted small" style="margin:0">Hoy sus gastos están solo en este equipo. Conecte la nube para tenerlos a salvo, usarlos en el celular y el computador, y compartir un libro con otra persona.</p>
        <p class="muted small" style="margin:0">Necesita un proyecto gratuito en <b>supabase.com</b>. La guía paso a paso está en el archivo <b>GUIA-NUBE.md</b> del proyecto.</p>
      </div>
      <div class="nube-box">
        <label class="field"><span>URL del proyecto</span><input type="text" id="nube-url" placeholder="https://xxxx.supabase.co" autocapitalize="off" autocorrect="off" spellcheck="false"></label>
        <label class="field"><span>Clave pública (anon)</span><input type="text" id="nube-key" placeholder="eyJhbGciOi…" autocapitalize="off" autocorrect="off" spellcheck="false"></label>
        ${msg}
        <div class="row"><button class="btn-primary" id="nube-conectar">Conectar</button></div>
      </div></div>`;
  } else if (!e.email) {
    html = `<div class="nube-grid">
      <div class="nube-box">
        <p class="muted small" style="margin:0">Entre con su cuenta para sincronizar. Si es la primera vez, use <b>Crear cuenta</b>: le llegará un correo para confirmarla.</p>
        ${e.fase === 'error' && e.error ? `<div class="nube-msg err">${esc(e.error)}</div>` : ''}
        ${cfg.desdeAjustes ? '<button class="btn-ghost" id="nube-desconectar" style="align-self:flex-start">Cambiar proyecto de nube</button>' : ''}
      </div>
      <div class="nube-box">
        <label class="field"><span>Correo</span><input type="email" id="nube-email" autocomplete="username" autocapitalize="off" inputmode="email"></label>
        <label class="field"><span>Contraseña</span><input type="password" id="nube-clave" autocomplete="current-password" minlength="6"></label>
        ${msg}
        <div class="row"><button class="btn-primary" id="nube-entrar">Entrar</button><button class="btn-ghost" id="nube-registrar">Crear cuenta</button></div>
      </div></div>`;
  } else {
    const l = e.libro || {};
    html = `<div class="nube-grid">
      <div class="nube-box">
        <h3>Su cuenta</h3>
        <div>${esc(e.email)}</div>
        <div class="muted small">${e.pendientes ? `${e.pendientes} cambios por subir` : 'Todo sincronizado'}${e.ultima ? ` · última vez ${fechaHora(e.ultima)}` : ''}</div>
        ${e.fase === 'error' && e.error ? `<div class="nube-msg err">${esc(e.error)}</div>` : ''}
        <div class="row"><button class="btn-primary" id="nube-sync">Sincronizar ahora</button><button class="btn-ghost" id="nube-salir">Cerrar sesión</button></div>
      </div>
      <div class="nube-box">
        <h3>Libro de gastos</h3>
        <div class="row"><input type="text" id="nube-libro-nombre" value="${esc(l.nombre || '')}" aria-label="Nombre del libro"><button class="btn-ghost" id="nube-renombrar">Renombrar</button></div>
        <div class="muted small">${l.miembros > 1 ? `Compartido entre ${l.miembros} personas` : 'Solo usted'}</div>
      </div>
      <div class="nube-box">
        <h3>Invitar a otra persona</h3>
        <div class="codigo" id="nube-codigo">${esc(l.codigo || '—')}</div>
        <div class="muted small">Pídale que instale la app, cree su cuenta y escriba este código en <b>Unirse a un libro</b>. Verán y registrarán los mismos gastos.</div>
        <div class="row"><button class="btn-ghost" id="nube-copiar">Copiar código</button></div>
      </div>
      <div class="nube-box">
        <h3>Unirse a un libro</h3>
        <div class="row"><input type="text" id="nube-unirse-cod" placeholder="Código de 8 letras" autocapitalize="characters" maxlength="8"><button class="btn-ghost" id="nube-unirse">Unirse</button></div>
        <div class="muted small">Los gastos registrados en este equipo se sumarán a ese libro.</div>
        ${msg}
      </div></div>`;
  }
  el('nube-cuerpo').innerHTML = html;
  nubeMsg = null;
  bindPanelNube();
}

async function accionNube(btn, fn) {
  btn.disabled = true;
  try { await fn(); } catch (err) { nubeMsg = { tipo: 'err', texto: err.message || String(err) }; }
  btn.disabled = false;
  renderNube();
}

function bindPanelNube() {
  const on = (id, fn) => el(id)?.addEventListener('click', e => accionNube(e.currentTarget, fn));
  on('nube-conectar', async () => {
    const url = el('nube-url').value.trim(), key = el('nube-key').value.trim();
    if (!/^https:\/\/.+/.test(url) || key.length < 20) throw new Error('Revise la URL (empieza con https://) y la clave pública.');
    const e = await guardarConfigNube(url, key);
    if (e.fase === 'error') throw new Error(e.error);
    nubeMsg = { tipo: 'ok', texto: 'Conectado. Ahora entre o cree su cuenta.' };
  });
  on('nube-desconectar', async () => { await guardarConfigNube('', ''); });
  const credenciales = () => {
    const email = el('nube-email').value.trim(), clave = el('nube-clave').value;
    if (!email || !clave) throw new Error('Escriba su correo y contraseña.');
    return [email, clave];
  };
  on('nube-entrar', async () => {
    await entrar(...credenciales());
    toast('✔ Sesión iniciada. Sincronizando…');
    await sincronizarYRefrescar();
  });
  on('nube-registrar', async () => {
    const r = await registrarse(...credenciales());
    if (r.confirmar) nubeMsg = { tipo: 'ok', texto: 'Cuenta creada. Abra el correo que le enviamos, confirme, y vuelva aquí a pulsar "Entrar".' };
    else { toast('✔ Cuenta creada. Sincronizando…'); await sincronizarYRefrescar(); }
  });
  on('nube-sync', async () => {
    const r = await sincronizarYRefrescar();
    if (r.ok) toast('✔ Sincronizado'); else if (r.error) throw new Error(r.error);
  });
  on('nube-salir', async () => {
    const ok = await dialogo({ titulo: 'Cerrar sesión', texto: 'Sus gastos quedan en este equipo y en la nube. Los cambios que haga sin sesión se subirán cuando vuelva a entrar.', ok: 'Cerrar sesión' });
    if (ok == null) return;
    await salir();
  });
  on('nube-renombrar', async () => { await renombrarLibro(el('nube-libro-nombre').value.trim() || 'Mis gastos'); toast('✔ Libro renombrado'); });
  on('nube-copiar', async () => {
    const cod = el('nube-codigo').textContent;
    try { await navigator.clipboard.writeText(cod); toast('✔ Código copiado'); }
    catch { const r = document.createRange(); r.selectNodeContents(el('nube-codigo')); getSelection().removeAllRanges(); getSelection().addRange(r); toast('Código seleccionado: cópielo'); }
  });
  on('nube-unirse', async () => {
    const cod = el('nube-unirse-cod').value.trim();
    if (cod.length < 6) throw new Error('Escriba el código completo.');
    const ok = await dialogo({ titulo: 'Unirse a un libro', texto: 'Desde ahora este equipo trabajará en el libro compartido, y los gastos registrados aquí se sumarán a él.', ok: 'Unirme' });
    if (ok == null) return;
    const l = await unirseALibro(cod);
    nubeMsg = { tipo: 'ok', texto: `Ahora está en el libro "${l.nombre}".` };
    await sincronizarYRefrescar();
  });
}

function reloj() {
  const tick = () => { el('clock').textContent = new Date().toLocaleTimeString('es-CL', { hour12: false }); };
  tick(); setInterval(tick, 1000);
}

/* ============================================================
   Navegación
   ============================================================ */
function irA(vista) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('is-active', t.dataset.view === vista));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('is-active', v.id === 'view-' + vista));
  el('fab').hidden = vista === 'registrar';
  if (vista === 'dashboard') renderDashboard();
  if (vista === 'libro') renderLibro();
  if (vista === 'ajustes') renderAjustes();
  window.scrollTo({ top: 0 });
}

function bindNav() {
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => irA(t.dataset.view)));
  document.querySelectorAll('[data-goto]').forEach(b => b.addEventListener('click', () => irA(b.dataset.goto)));
  el('fab').addEventListener('click', () => { limpiarForm(); irA('registrar'); el('foto').click(); });
  el('periodo').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    S.periodo = b.dataset.p;
    el('periodo').querySelectorAll('button').forEach(x => x.classList.toggle('is-active', x === b));
    renderDashboard();
  });
}

function render() {
  const activa = document.querySelector('.view.is-active')?.id.replace('view-', '');
  renderTicker();
  if (activa === 'dashboard') renderDashboard();
  if (activa === 'libro') renderLibro();
  if (activa === 'ajustes') renderAjustes();
}

/* ============================================================
   Contexto del período
   ============================================================ */
function contexto(p = S.periodo) {
  const r = rango(p);
  const lista = activos();
  const A = lista.filter(g => enRango(g, r.desde, r.hasta));
  const B = lista.filter(g => enRango(g, r.prevDesde, r.prevHasta));
  const tA = total(A), tB = total(B);
  const pptoMes = Object.values(S.presupuestos).reduce((s, v) => s + (+v || 0), 0);
  // presupuesto del período: mensual completo si es un mes, prorrateado si no
  const factor = r.mensual ? 1 : r.dias / 30.44;
  return { r, A, B, tA, tB, pptoMes, ppto: pptoMes * factor, factor };
}

/* ============================================================
   Ticker
   ============================================================ */
function renderTicker() {
  const { A, B, tA, tB } = contexto('mes');
  const items = S.categorias.map(c => {
    const a = total(A.filter(g => g.categoria === c)), b = total(B.filter(g => g.categoria === c));
    return { c, a, v: varPct(a, b) };
  }).filter(x => x.a > 0 || x.v !== 0);
  const vt = varPct(tA, tB);
  const fmt = (name, a, v, cat) => {
    const cls = v == null ? '' : v > 0 ? 'pos' : v < 0 ? 'neg' : '';
    const arrow = v == null ? '●' : v > 0 ? '▲' : v < 0 ? '▼' : '■';
    return `<span class="tick" ${cat ? `data-cat="${esc(cat)}"` : 'data-kpi="total"'}><b>${esc(name)}</b><span class="v">${$(a)}</span><span class="${cls}">${arrow} ${v == null ? 'nuevo' : pct(v).replace('+', '')}</span></span>`;
  };
  const html = [fmt('TOTAL MES', tA, vt), ...items.map(x => fmt(x.c.toUpperCase(), x.a, x.v, x.c))].join('');
  el('ticker').innerHTML = items.length || tA ? html + html : '<span class="tick"><b>SIN MOVIMIENTOS</b><span class="v">Registre su primera boleta</span></span>';
}

/* ============================================================
   Dashboard
   ============================================================ */
function renderDashboard() {
  const ctx = contexto();
  const { r, A, B, tA, tB, ppto } = ctx;
  el('periodo-label').textContent = `${r.rotulo} · vs ${r.prevLabel}`;

  // ---- KPIs
  const diario = serieDiaria(A, r.desde, r.hasta);
  const prom = tA / r.dias, promB = tB / r.prevDias;
  const tk = A.length ? tA / A.length : 0, tkB = B.length ? tB / B.length : 0;
  const conFoto = A.filter(tieneRespaldo).length;
  const resp = A.length ? conFoto / A.length * 100 : 0;
  const respB = B.length ? B.filter(tieneRespaldo).length / B.length * 100 : 0;
  const cats = agrupar(A, g => g.categoria);
  const top = cats[0];

  const kpis = [
    { id: 'total', label: 'Gasto del período', value: $(tA), sub: `${deltaChip(varPct(tA, tB))}<span>vs ${$k(tB)}</span>`, spark: sparkline(acumular(diario), ACCENT) },
    { id: 'promedio', label: 'Promedio diario', value: $(prom), sub: `${deltaChip(varPct(prom, promB))}<span>${r.dias} días</span>`, spark: sparkline(diario, PALETA[0]) },
    { id: 'ticket', label: 'Ticket promedio', value: $(tk), sub: `${deltaChip(varPct(tk, tkB))}<span>mediana ${$k(mediana(A.map(g => g.monto)))}</span>` },
    { id: 'transacciones', label: 'Transacciones', value: num(A.length), sub: `${deltaChip(varPct(A.length, B.length))}<span>${num(A.length / r.dias)} por día</span>` },
  ];
  if (r.enCurso) {
    const dm = diasDelMes(toDate(r.desde).getFullYear(), toDate(r.desde).getMonth());
    const proy = r.dias ? tA / r.dias * dm : 0;
    const ref = ppto || null;
    kpis.push({ id: 'proyeccion', label: 'Proyección cierre mes', value: $(proy), sub: ref ? `${deltaChip(varPct(proy, ref))}<span>vs presupuesto</span>` : `<span>${dm - r.dias} días restantes</span>` });
  } else {
    const max = A.reduce((m, g) => g.monto > (m?.monto || 0) ? g : m, null);
    kpis.push({ id: 'mayor', label: 'Mayor gasto', value: $(max?.monto || 0), sub: `<span>${esc(max?.comercio || '—')}</span>` });
  }
  const consumo = ppto ? tA / ppto * 100 : null;
  kpis.push({
    id: 'presupuesto', label: 'Presupuesto consumido', value: consumo == null ? '—' : pctPlano(consumo),
    sub: consumo == null ? '<span>Sin presupuesto definido</span>' : `${estadoChip(consumo, r.enCurso ? r.dias / diasDelMes(toDate(r.desde).getFullYear(), toDate(r.desde).getMonth()) * 100 : 100)}<span>de ${$k(ppto)}</span>`,
  });
  kpis.push({ id: 'respaldo', label: 'Respaldo documental', value: pctPlano(resp), sub: `${deltaChip(resp - respB, { invertir: true }).replace('%', ' pp')}<span>${A.length - conFoto} sin respaldo</span>` });
  kpis.push({ id: 'categoria', label: 'Categoría principal', value: esc(top?.clave || '—'), sub: top ? `<span><i class="swatch" style="background:${colorCat(top.clave)}"></i>${pctPlano(top.total / tA * 100)} del gasto · ${$k(top.total)}</span>` : '<span>—</span>' });

  el('kpis').innerHTML = kpis.map(k => `
    <button class="kpi" data-kpi="${k.id}">
      <span class="kpi-open">↗</span>
      <span class="kpi-label">${k.label}</span>
      <span class="kpi-value">${k.value}</span>
      <span class="kpi-sub">${k.sub}</span>
      ${k.spark ? `<span class="kpi-spark">${k.spark}</span>` : ''}
    </button>`).join('');

  // ---- Acumulado actual vs anterior
  const accA = acumular(diario);
  const accB = acumular(serieDiaria(B, r.prevDesde, r.prevHasta));
  const largo = Math.max(r.fin ? diffDays(r.desde, r.fin) + 1 : accA.length, accB.length);
  const labels = Array.from({ length: largo }, (_, i) => r.dias > 62 ? mesCorto(addDays(r.desde, i)) : 'D' + (i + 1));
  el('legend-acum').innerHTML = `<span><i style="background:${ACCENT}"></i>${esc(r.label)}</span><span><i class="dashed"></i>${esc(r.prevLabel)}</span>`;
  lineChart(el('chart-acum'), {
    series: [
      { name: 'Actual', color: ACCENT, values: pad(accA, largo) },
      { name: 'Anterior', color: GRIS, values: pad(accB, largo), dashed: true },
    ],
    labels, fmt: $, fmtAxis: $k,
    tipTitle: i => `Día ${i + 1} · ${fechaCorta(addDays(r.desde, i))}`,
  });

  // ---- Categorías
  el('cat-bars').innerHTML = hbars(cats.map(c => ({ name: c.clave, value: c.total, color: colorCat(c.clave), attr: `data-cat="${esc(c.clave)}"`, extra: pctPlano(c.total / tA * 100) })), 'Sin gastos en el período');

  // ---- Flujo
  const serie = serieAgrupada(A, r.desde, r.hasta);
  const gran = serie[0]?.gran || 'día';
  el('flujo-title').textContent = `Flujo de gasto por ${gran}`;
  const promBar = serie.length ? total(A) / serie.length : 0;
  barChart(el('chart-flujo'), {
    bars: serie.map(s => ({
      label: gran === 'mes' ? mesCorto(s.desde) : fechaCorta(s.desde), value: s.value, color: PALETA[0],
      tipTitle: s.desde === s.hasta ? fechaLarga(s.desde) : `${fechaCorta(s.desde)} – ${fechaCorta(s.hasta)}`, s,
    })),
    fmt: $, fmtAxis: $k, ref: { value: promBar, label: `prom. ${$k(promBar)}` },
    onClick: (i, b) => abrir(drillRango(b.s.desde, b.s.hasta)),
  });

  // ---- Top comercios
  const coms = agrupar(A, g => g.comercio).slice(0, 8);
  el('top-comercios').innerHTML = hbars(coms.map(c => ({ name: c.clave, value: c.total, color: PALETA[0], attr: `data-comercio="${esc(c.clave)}"`, extra: `${c.n}×` })), 'Sin comercios en el período');

  // ---- Últimos
  const ult = [...activos()].sort(ordenReciente).slice(0, 8);
  el('ultimos').innerHTML = tablaGastos(ult, { vacio: 'Aún no hay gastos registrados. Use <b>＋ Boleta</b> para registrar el primero o cargue datos demo en Ajustes.' });
  hidratarImgs(el('ultimos'));
  renderTicker();
}

const pad = (arr, n) => Array.from({ length: n }, (_, i) => i < arr.length ? arr[i] : null);
const ordenReciente = (a, b) => b.fecha.localeCompare(a.fecha) || (b.creado || 0) - (a.creado || 0);

function estadoChip(consumo, esperado = 100) {
  if (consumo > 100) return '<span class="status-chip ex">✖ Excedido</span>';
  if (consumo > Math.max(esperado, 0) * 1.1 || consumo > 90) return '<span class="status-chip al">▲ Alerta</span>';
  return '<span class="status-chip ok">✔ En rango</span>';
}

function hbars(rows, vacio) {
  if (!rows.length) return `<div class="empty">${vacio}</div>`;
  const max = Math.max(...rows.map(r => r.value));
  return rows.map(r => `
    <button class="hbar" ${r.attr || ''}>
      <span class="hbar-name"><i class="swatch" style="background:${r.color}"></i>${esc(r.name)}</span>
      <span class="hbar-track"><span class="hbar-fill" style="width:${(r.value / max * 100).toFixed(1)}%;background:${r.color}"></span></span>
      <span class="hbar-val">${$(r.value)}${r.extra ? `<small>${r.extra}</small>` : ''}</span>
    </button>`).join('');
}

function tablaGastos(list, { vacio = 'Sin movimientos', limite, foot = false } = {}) {
  if (!list.length) return `<div class="empty">${vacio}</div>`;
  const rows = (limite ? list.slice(0, limite) : list).map(g => `
    <tr data-gasto="${g.id}" class="${g.anulado ? 'anulado' : ''}">
      <td>${g.imagenId ? `<img class="thumb" data-img="${g.imagenId}" alt="">` : deCartola(g) ? '<span class="thumb-empty" title="Respaldo: cartola bancaria">▤</span>' : '<span class="thumb-empty">s/f</span>'}</td>
      <td class="mono">${fechaCorta(g.fecha)}</td>
      <td><div>${esc(g.comercio)}${g.comercioPendiente ? '<span class="tag-pendiente">● completar</span>' : ''}</div><div class="id">${folio(g)}${g.folio ? ' · N° ' + esc(g.folio) : ''}</div></td>
      <td class="hide-sm"><span class="tag"><i class="swatch" style="background:${colorCat(g.categoria)}"></i>${esc(g.categoria)}</span></td>
      <td class="hide-sm muted">${esc(g.medioPago || '')}</td>
      <td class="num">${$(g.monto)}</td>
    </tr>`).join('');
  const pie = foot ? `<tfoot><tr><td colspan="5">Total (${list.filter(g => !g.anulado).length} registros)</td><td class="num">${$(total(list.filter(g => !g.anulado)))}</td></tr></tfoot>` : '';
  const mas = limite && list.length > limite ? `<div class="empty small">… y ${list.length - limite} movimientos más</div>` : '';
  return `<div class="table-wrap"><table>
    <thead><tr><th></th><th>Fecha</th><th>Comercio</th><th class="hide-sm">Categoría</th><th class="hide-sm">Medio</th><th class="num">Monto</th></tr></thead>
    <tbody>${rows}</tbody>${pie}</table></div>${mas}`;
}

// Algunos Safari no guardan Blob en IndexedDB: si falla, se guarda como ArrayBuffer.
async function guardarImagen(meta, blob) {
  try {
    await db.put('imagenes', { ...meta, blob });
  } catch {
    await db.put('imagenes', { ...meta, buf: await blob.arrayBuffer(), type: blob.type || 'image/jpeg' });
  }
}
const blobDe = r => r.blob || new Blob([r.buf], { type: r.type || 'image/jpeg' });

const urlCache = new Map();
async function urlImagen(id) {
  if (urlCache.has(id)) return urlCache.get(id);
  let r = await db.get('imagenes', id);
  if (!r) {
    // foto registrada en otro equipo: se descarga de la nube y queda guardada aquí
    const blob = await bajarFoto(id);
    if (!blob) return null;
    await guardarImagen({ id, creado: Date.now() }, blob);
    r = { blob };
  }
  const u = URL.createObjectURL(blobDe(r));
  urlCache.set(id, u);
  return u;
}
function hidratarImgs(root) {
  root.querySelectorAll('img[data-img]').forEach(async img => {
    const u = await urlImagen(img.dataset.img);
    if (u) img.src = u;
  });
}

/* ============================================================
   Drawer de análisis (bajada del número)
   ============================================================ */
const pila = [];
function abrir(vista, { reemplazar = false } = {}) {
  if (reemplazar) pila.pop();
  pila.push(vista);
  pintarDrawer();
  el('drawer').classList.add('is-open');
  el('drawer').setAttribute('aria-hidden', 'false');
  el('drawer-backdrop').hidden = false;
  document.body.style.overflow = 'hidden';
}
function cerrar() {
  pila.length = 0;
  setTimeout(() => { if (!pila.length) el('drawer-body').innerHTML = ''; }, 300);
  el('drawer').classList.remove('is-open');
  el('drawer').setAttribute('aria-hidden', 'true');
  el('drawer-backdrop').hidden = true;
  document.body.style.overflow = '';
}
function pintarDrawer() {
  const v = pila[pila.length - 1];
  if (!v) return cerrar();
  el('drawer-kicker').textContent = v.kicker || 'ANÁLISIS';
  el('drawer-title').textContent = v.titulo;
  el('drawer-back').hidden = pila.length < 2;
  const body = el('drawer-body');
  body.innerHTML = v.html();
  body.scrollTop = 0;
  requestAnimationFrame(() => { v.montar?.(body); hidratarImgs(body); });
}
function bindDrawer() {
  el('drawer-close').addEventListener('click', cerrar);
  el('drawer-backdrop').addEventListener('click', cerrar);
  el('drawer-back').addEventListener('click', () => { pila.pop(); pintarDrawer(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && pila.length) cerrar(); });
}

function bindDelegados() {
  document.addEventListener('click', e => {
    const k = e.target.closest('[data-kpi]');
    if (k) return abrir(drillKpi(k.dataset.kpi));
    const c = e.target.closest('[data-cat]');
    if (c) return abrir(drillCategoria(c.dataset.cat));
    const m = e.target.closest('[data-comercio]');
    if (m) return abrir(drillComercio(m.dataset.comercio));
    const g = e.target.closest('[data-gasto]');
    if (g) return abrir(drillGasto(g.dataset.gasto));
  });
  el('panel-acum').addEventListener('click', () => abrir(drillKpi('total')));
  el('panel-flujo').addEventListener('click', () => abrir(drillKpi('promedio')));
  ['panel-acum', 'panel-flujo'].forEach(id => el(id).addEventListener('keydown', e => { if (e.key === 'Enter') el(id).click(); }));
}

function drillKpi(id) {
  switch (id) {
    case 'total': return drillTotal();
    case 'promedio': return drillPromedio();
    case 'ticket': return drillTicket();
    case 'transacciones': return drillTransacciones();
    case 'proyeccion': return drillProyeccion();
    case 'mayor': { const { A } = contexto(); const g = [...A].sort((a, b) => b.monto - a.monto)[0]; return g ? drillGasto(g.id) : drillTotal(); }
    case 'presupuesto': return drillPresupuesto();
    case 'respaldo': return drillRespaldo();
    case 'categoria': { const { A } = contexto(); const c = agrupar(A, g => g.categoria)[0]; return c ? drillCategoria(c.clave) : drillTotal(); }
  }
  return drillTotal();
}

const hero = (valor, chip, sub) => `<div class="hero"><span class="hero-num">${valor}</span>${chip || ''}</div>${sub ? `<div class="hero-sub">${sub}</div>` : ''}`;
const minis = arr => `<div class="minis">${arr.map(([l, v]) => `<div class="mini"><div class="l">${l}</div><div class="v">${v}</div></div>`).join('')}</div>`;
const sec = t => `<div class="section-title">${t}</div>`;
const sube = v => v > 0 ? 'sube' : 'baja';

function tablaVariacion(filas, { dimension, attr }) {
  if (!filas.length) return '<div class="empty">Sin datos</div>';
  return `<div class="panel panel-flush"><div class="table-wrap"><table>
    <thead><tr><th>${dimension}</th><th class="num">Actual</th><th class="num hide-sm">Anterior</th><th class="num">Δ $</th><th class="num">Δ %</th><th class="num hide-sm" title="Puntos porcentuales que aporta a la variación total">Aporte</th></tr></thead>
    <tbody>${filas.map(f => `<tr ${attr(f.clave)}>
      <td>${dimension === 'Categoría' ? `<i class="swatch" style="background:${colorCat(f.clave)}"></i>` : ''}${esc(f.clave)}</td>
      <td class="num">${$(f.actual)}</td><td class="num hide-sm muted">${$(f.anterior)}</td>
      <td class="num ${f.delta > 0 ? 'pos' : f.delta < 0 ? 'neg' : ''}">${f.delta > 0 ? '+' : ''}${$(f.delta)}</td>
      <td class="num">${f.var == null ? 'nuevo' : pct(f.var)}</td>
      <td class="num hide-sm">${f.aporte == null ? '—' : pct(f.aporte) + ' pp'}</td></tr>`).join('')}</tbody></table></div></div>`;
}

function narrativaVariacion(desc, deltaTotal) {
  const signo = Math.sign(deltaTotal);
  const motores = desc.filter(d => Math.sign(d.delta) === signo && d.delta !== 0).slice(0, 2);
  const contra = desc.filter(d => Math.sign(d.delta) === -signo && d.delta !== 0).slice(0, 1);
  let t = '';
  if (motores.length && signo !== 0) {
    t += `<p>La variación se explica principalmente por ${motores.map(d => `<b>${esc(d.clave)}</b> (${d.delta > 0 ? '+' : ''}${$(d.delta)}${d.peso != null ? `, ${pctPlano(Math.abs(d.peso))} del cambio` : ''})`).join(' y ')}.</p>`;
  }
  if (contra.length) t += `<p>En sentido contrario, <b>${esc(contra[0].clave)}</b> ${contra[0].delta < 0 ? 'bajó' : 'subió'} ${$(Math.abs(contra[0].delta))}.</p>`;
  return t;
}

/* ---------- Gasto total ---------- */
function drillTotal() {
  return {
    kicker: 'ANÁLISIS · GASTO TOTAL', titulo: 'Gasto del período',
    html() {
      const { r, A, B, tA, tB, ppto } = contexto();
      const v = varPct(tA, tB), d = tA - tB;
      const desc = descomponer(A, B, g => g.categoria);
      const descCom = descomponer(A, B, g => g.comercio).slice(0, 8);
      let ins = `<p>El gasto de <b>${esc(r.label)}</b> suma <b>${$(tA)}</b>${tB ? `, ${v > 0 ? 'un alza' : 'una baja'} de <b>${pctPlano(Math.abs(v), 1)}</b> (${d > 0 ? '+' : '−'}${$(Math.abs(d))}) respecto de ${esc(r.prevLabel)}` : ''}.</p>`;
      ins += narrativaVariacion(desc, d);
      if (ppto) ins += `<p>Consume el <b>${pctPlano(tA / ppto * 100)}</b> del presupuesto del período (${$(ppto)}).</p>`;
      return hero($(tA), deltaChip(v), `vs ${$(tB)} en ${esc(r.prevLabel)} · ${esc(r.rotulo)}`)
        + `<div class="insight">${ins}</div>`
        + minis([['Período anterior', $(tB)], ['Variación $', (d > 0 ? '+' : '') + $(d)], ['Variación %', pct(v)], ['Transacciones', num(A.length)]])
        + sec('Acumulado actual vs anterior') + `<div class="legend"><span><i style="background:${ACCENT}"></i>Actual</span><span><i class="dashed"></i>Anterior</span></div><div class="chart" id="d-acum"></div>`
        + sec('Puente de variación por categoría') + tablaVariacion(desc, { dimension: 'Categoría', attr: k => `data-cat="${esc(k)}"` })
        + sec('Variación por comercio (top 8)') + tablaVariacion(descCom, { dimension: 'Comercio', attr: k => `data-comercio="${esc(k)}"` })
        + sec('Mayores gastos del período') + `<div class="panel panel-flush">${tablaGastos([...A].sort((a, b) => b.monto - a.monto), { limite: 10 })}</div>`;
    },
    montar() {
      const { r, A, B } = contexto();
      const a = acumular(serieDiaria(A, r.desde, r.hasta)), b = acumular(serieDiaria(B, r.prevDesde, r.prevHasta));
      const n = Math.max(a.length, b.length);
      lineChart(el('d-acum'), {
        series: [{ name: 'Actual', color: ACCENT, values: pad(a, n) }, { name: 'Anterior', color: GRIS, values: pad(b, n), dashed: true }],
        labels: Array.from({ length: n }, (_, i) => 'D' + (i + 1)), fmt: $, fmtAxis: $k, height: 220,
        tipTitle: i => `Día ${i + 1} · ${fechaCorta(addDays(r.desde, i))}`,
      });
    },
  };
}

/* ---------- Promedio diario ---------- */
function drillPromedio() {
  return {
    kicker: 'ANÁLISIS · RITMO DE GASTO', titulo: 'Promedio diario',
    html() {
      const { r, A, tA, tB } = contexto();
      const dia = serieDiaria(A, r.desde, r.hasta);
      const prom = tA / r.dias, promB = tB / r.prevDias;
      const iMax = dia.indexOf(Math.max(...dia));
      const fMax = addDays(r.desde, Math.max(0, iMax));
      const gMax = agrupar(A.filter(g => g.fecha === fMax), g => g.comercio)[0];
      const sinGasto = dia.filter(v => v === 0).length;
      const ds = porDiaSemana(A);
      const iDs = ds.reduce((m, x, i) => x.total > ds[m].total ? i : m, 0);
      let ins = `<p>Promedio de <b>${$(prom)}</b> por día en ${r.dias} días${promB ? `, ${pctPlano(Math.abs(varPct(prom, promB)), 1)} ${prom > promB ? 'sobre' : 'bajo'} el ritmo anterior (${$(promB)}/día)` : ''}.</p>`;
      if (tA) ins += `<p>El día de mayor gasto fue el <b>${fechaLarga(fMax)}</b> con <b>${$(dia[iMax])}</b>${gMax ? `, principalmente en ${esc(gMax.clave)}` : ''}. Hubo ${sinGasto} días sin gasto. Los <b>${DIAS[iDs]}</b> concentran el ${pctPlano(ds[iDs].total / tA * 100)} del gasto.</p>`;
      return hero($(prom), deltaChip(varPct(prom, promB)), `por día · ${esc(r.rotulo)}`)
        + `<div class="insight">${ins}</div>`
        + minis([['Mediana diaria', $(mediana(dia))], ['Día máximo', $(dia[iMax] || 0)], ['Días con gasto', num(r.dias - sinGasto)], ['Días sin gasto', num(sinGasto)]])
        + sec('Gasto por día · pinche una barra') + '<div class="chart" id="d-dia"></div>'
        + sec('Distribución por día de la semana') + '<div class="chart" id="d-ds"></div>';
    },
    montar() {
      const { r, A, tA } = contexto();
      const dia = serieDiaria(A, r.desde, r.hasta);
      barChart(el('d-dia'), {
        bars: dia.map((v, i) => { const f = addDays(r.desde, i); return { label: fechaCorta(f), value: v, color: PALETA[0], tipTitle: `${DIAS[toDate(f).getDay()]} ${fechaLarga(f)}`, f }; }),
        fmt: $, fmtAxis: $k, ref: { value: tA / r.dias, label: 'promedio' },
        onClick: (i, b) => abrir(drillRango(b.f, b.f)),
      });
      const ds = porDiaSemana(A);
      const orden = [1, 2, 3, 4, 5, 6, 0];
      barChart(el('d-ds'), {
        bars: orden.map(i => ({ label: DIAS[i], value: ds[i].total, color: PALETA[6], tipExtra: `<div class="t-r"><span>Transacciones</span><b>${ds[i].n}</b></div>` })),
        fmt: $, fmtAxis: $k, height: 180,
      });
    },
  };
}

/* ---------- Ticket ---------- */
function drillTicket() {
  return {
    kicker: 'ANÁLISIS · TAMAÑO DE COMPRA', titulo: 'Ticket promedio',
    html() {
      const { r, A, B, tA, tB } = contexto();
      const tk = A.length ? tA / A.length : 0, tkB = B.length ? tB / B.length : 0;
      const med = mediana(A.map(g => g.monto));
      const top5 = [...A].sort((a, b) => b.monto - a.monto).slice(0, 5);
      const pTop = tA ? total(top5) / tA * 100 : 0;
      const sesgo = med ? tk / med : 1;
      let ins = `<p>El ticket promedio es <b>${$(tk)}</b> y la mediana <b>${$(med)}</b>.</p>`;
      if (A.length) ins += `<p>${sesgo > 1.4 ? `El promedio supera en ${pctPlano((sesgo - 1) * 100)} a la mediana: <b>pocos gastos grandes elevan el promedio</b>.` : 'La distribución es relativamente homogénea: el promedio representa bien la compra típica.'} Los 5 mayores gastos explican el <b>${pctPlano(pTop)}</b> del total.</p>`;
      const porCat = agrupar(A, g => g.categoria);
      return hero($(tk), deltaChip(varPct(tk, tkB)), `vs ${$(tkB)} · ${esc(r.prevLabel)}`)
        + `<div class="insight">${ins}</div>`
        + minis([['Mediana', $(med)], ['Ticket máximo', $(top5[0]?.monto || 0)], ['Ticket mínimo', $(A.length ? Math.min(...A.map(g => g.monto)) : 0)], ['Top 5 / total', pctPlano(pTop)]])
        + sec('Distribución por tramo de monto') + '<div class="chart" id="d-hist"></div>'
        + sec('Ticket por categoría') + `<div class="panel panel-flush"><div class="table-wrap"><table>
          <thead><tr><th>Categoría</th><th class="num">N°</th><th class="num">Ticket prom.</th><th class="num hide-sm">Máximo</th></tr></thead>
          <tbody>${porCat.map(c => `<tr data-cat="${esc(c.clave)}"><td><i class="swatch" style="background:${colorCat(c.clave)}"></i>${esc(c.clave)}</td><td class="num">${c.n}</td><td class="num">${$(c.total / c.n)}</td><td class="num hide-sm">${$(Math.max(...c.items.map(g => g.monto)))}</td></tr>`).join('')}</tbody></table></div></div>`
        + sec('Mayores gastos') + `<div class="panel panel-flush">${tablaGastos([...A].sort((a, b) => b.monto - a.monto), { limite: 10 })}</div>`;
    },
    montar() {
      const { A } = contexto();
      barChart(el('d-hist'), {
        bars: histogramaTicket(A).map(t => ({ label: t.label, value: t.n, color: PALETA[0], tipLabel: 'Transacciones', tipExtra: `<div class="t-r"><span>Monto</span><b>${$(t.total)}</b></div>` })),
        fmt: v => num(v), fmtAxis: v => num(Math.round(v)), height: 190,
      });
    },
  };
}

/* ---------- Transacciones ---------- */
function drillTransacciones() {
  return {
    kicker: 'ANÁLISIS · FRECUENCIA', titulo: 'Transacciones',
    html() {
      const { r, A, B } = contexto();
      const coms = agrupar(A, g => g.comercio).sort((a, b) => b.n - a.n);
      const medios = agrupar(A, g => g.medioPago || 'Sin dato');
      let ins = `<p><b>${A.length}</b> transacciones en ${r.dias} días (${num(A.length / r.dias)} por día), frente a ${B.length} en ${esc(r.prevLabel)}.</p>`;
      if (coms[0]) ins += `<p>El comercio más frecuente es <b>${esc(coms[0].clave)}</b> con ${coms[0].n} visitas (${$(coms[0].total)}). El medio de pago dominante es <b>${esc(medios[0].clave)}</b> (${pctPlano(medios[0].total / total(A) * 100)} del monto).</p>`;
      return hero(num(A.length), deltaChip(varPct(A.length, B.length)), `vs ${B.length} · ${esc(r.prevLabel)}`)
        + `<div class="insight">${ins}</div>`
        + sec('Transacciones por día de la semana') + '<div class="chart" id="d-freq"></div>'
        + sec('Por medio de pago') + `<div class="hbars">${hbars(medios.map((m, i) => ({ name: m.clave, value: m.total, color: PALETA[i % 8], extra: `${m.n}×` })))}</div>`
        + sec('Comercios por frecuencia') + `<div class="panel panel-flush"><div class="table-wrap"><table>
          <thead><tr><th>Comercio</th><th class="num">Visitas</th><th class="num">Total</th><th class="num hide-sm">Ticket</th></tr></thead>
          <tbody>${coms.slice(0, 15).map(c => `<tr data-comercio="${esc(c.clave)}"><td>${esc(c.clave)}</td><td class="num">${c.n}</td><td class="num">${$(c.total)}</td><td class="num hide-sm">${$(c.total / c.n)}</td></tr>`).join('')}</tbody></table></div></div>`;
    },
    montar() {
      const { A } = contexto();
      const ds = porDiaSemana(A);
      barChart(el('d-freq'), {
        bars: [1, 2, 3, 4, 5, 6, 0].map(i => ({ label: DIAS[i], value: ds[i].n, color: PALETA[2], tipLabel: 'Transacciones', tipExtra: `<div class="t-r"><span>Monto</span><b>${$(ds[i].total)}</b></div>` })),
        fmt: v => num(v), fmtAxis: v => num(Math.round(v)), height: 180,
      });
    },
  };
}

/* ---------- Proyección ---------- */
function drillProyeccion() {
  const base = () => {
    const ctx = contexto('mes');
    const d0 = toDate(ctx.r.desde);
    const dm = diasDelMes(d0.getFullYear(), d0.getMonth());
    const ritmo = ctx.tA / ctx.r.dias;
    const mesAnt = rango('mesant');
    const tMesAnt = total(activos().filter(g => enRango(g, mesAnt.desde, mesAnt.hasta)));
    return { ...ctx, dm, ritmo, proy: ritmo * dm, restantes: dm - ctx.r.dias, tMesAnt, mesAnt };
  };
  return {
    kicker: 'ANÁLISIS · PROYECCIÓN', titulo: 'Proyección de cierre de mes',
    html() {
      const { r, tA, dm, ritmo, proy, restantes, ppto, tMesAnt, mesAnt, A } = base();
      let ins = `<p>Al ritmo actual de <b>${$(ritmo)}/día</b>, el mes cerraría en <b>${$(proy)}</b>${tMesAnt ? `, ${pctPlano(Math.abs(varPct(proy, tMesAnt)), 1)} ${proy > tMesAnt ? 'sobre' : 'bajo'} ${esc(mesAnt.label)} (${$(tMesAnt)})` : ''}.</p>`;
      if (ppto) {
        const disp = ppto - tA;
        ins += disp > 0
          ? `<p>Para cerrar dentro del presupuesto de <b>${$(ppto)}</b> quedan <b>${$(disp)}</b>: un máximo de <b>${$(disp / Math.max(1, restantes))}/día</b> en los ${restantes} días restantes${ritmo > disp / Math.max(1, restantes) ? ` — <b>${pctPlano((ritmo / (disp / Math.max(1, restantes)) - 1) * 100)} por debajo del ritmo actual</b>` : ''}.</p>`
          : `<p><b>El presupuesto de ${$(ppto)} ya fue superado</b> en ${$(-disp)}.</p>`;
      } else ins += '<p>Defina un presupuesto mensual en <b>Ajustes</b> para medir la holgura disponible.</p>';
      const filas = S.categorias.map(c => {
        const g = total(A.filter(x => x.categoria === c));
        const p = +S.presupuestos[c] || 0;
        return { c, g, proy: g / r.dias * dm, p };
      }).filter(f => f.g || f.p).sort((a, b) => b.proy - a.proy);
      return hero($(proy), ppto ? deltaChip(varPct(proy, ppto)) : '', `cierre estimado de ${esc(r.label)}${ppto ? ' · vs presupuesto' : ''}`)
        + `<div class="insight">${ins}</div>`
        + minis([['Gastado a la fecha', $(tA)], ['Días transcurridos', `${r.dias}/${dm}`], ['Ritmo diario', $(ritmo)], ['Mes anterior', $(tMesAnt)]])
        + sec('Trayectoria del mes') + `<div class="legend"><span><i style="background:${ACCENT}"></i>Real</span><span><i style="background:${PALETA[3]}"></i>Proyección</span>${ppto ? `<span><i style="background:${PALETA[7]}"></i>Presupuesto</span>` : ''}<span><i class="dashed"></i>Mes anterior</span></div><div class="chart" id="d-proy"></div>`
        + sec('Proyección por categoría') + `<div class="panel panel-flush"><div class="table-wrap"><table>
          <thead><tr><th>Categoría</th><th class="num">A la fecha</th><th class="num">Proyección</th><th class="num hide-sm">Presupuesto</th><th>Estado</th></tr></thead>
          <tbody>${filas.map(f => `<tr data-cat="${esc(f.c)}"><td><i class="swatch" style="background:${colorCat(f.c)}"></i>${esc(f.c)}</td><td class="num">${$(f.g)}</td><td class="num">${$(f.proy)}</td><td class="num hide-sm">${f.p ? $(f.p) : '—'}</td><td>${f.p ? estadoChip(f.proy / f.p * 100) : '<span class="muted">—</span>'}</td></tr>`).join('')}</tbody></table></div></div>`;
    },
    montar() {
      const { r, A, dm, ritmo, ppto, mesAnt } = base();
      const real = acumular(serieDiaria(A, r.desde, r.hasta));
      const ant = acumular(serieDiaria(activos().filter(g => enRango(g, mesAnt.desde, mesAnt.hasta)), mesAnt.desde, mesAnt.hasta));
      const ult = real[real.length - 1] || 0;
      const proy = Array.from({ length: dm }, (_, i) => i < real.length - 1 ? null : ult + ritmo * (i - real.length + 1));
      const series = [
        { name: 'Real', color: ACCENT, values: pad(real, dm) },
        { name: 'Proyección', color: PALETA[3], values: proy, dashed: true },
      ];
      if (ppto) series.push({ name: 'Presupuesto', color: PALETA[7], values: Array(dm).fill(ppto) });
      series.push({ name: 'Mes anterior', color: GRIS, values: pad(ant, dm), dashed: true });
      lineChart(el('d-proy'), { series, labels: Array.from({ length: dm }, (_, i) => String(i + 1)), fmt: $, fmtAxis: $k, area: true, tipTitle: i => `Día ${i + 1}` });
    },
  };
}

/* ---------- Presupuesto ---------- */
function drillPresupuesto() {
  return {
    kicker: 'CONTROL · PRESUPUESTO', titulo: 'Presupuesto consumido',
    html() {
      const { r, A, tA, ppto, factor } = contexto();
      if (!ppto) return `<div class="empty"><b>Sin presupuesto definido</b>Configure montos mensuales por categoría para activar el control.</div><button class="btn-primary" id="d-ir-ppto">Ir a Ajustes</button>`;
      const d0 = toDate(r.desde);
      const esperado = r.enCurso ? r.dias / diasDelMes(d0.getFullYear(), d0.getMonth()) * 100 : 100;
      const filas = S.categorias.map(c => {
        const p = (+S.presupuestos[c] || 0) * factor, g = total(A.filter(x => x.categoria === c));
        return { c, p, g, pc: p ? g / p * 100 : null };
      }).filter(f => f.p || f.g).sort((a, b) => (b.pc ?? 999) - (a.pc ?? 999));
      const ex = filas.filter(f => f.pc == null ? f.g > 0 : f.pc > 100);
      const al = filas.filter(f => f.pc != null && f.pc <= 100 && (f.pc > esperado * 1.1 || f.pc > 90));
      const consumo = tA / ppto * 100;
      let ins = `<p>Se ha consumido el <b>${pctPlano(consumo)}</b> del presupuesto (${$(tA)} de ${$(ppto)})${r.enCurso ? `, con el <b>${pctPlano(esperado)}</b> del mes transcurrido` : ''}.</p>`;
      if (ex.length) ins += `<p><b>Excedidas:</b> ${ex.map(f => `${esc(f.c)} (${f.pc == null ? 'sin presupuesto' : pctPlano(f.pc)})`).join(', ')}.</p>`;
      if (al.length) ins += `<p><b>En alerta:</b> ${al.map(f => `${esc(f.c)} (${pctPlano(f.pc)})`).join(', ')}.</p>`;
      if (!ex.length && !al.length) ins += '<p>Todas las categorías están dentro del rango esperado.</p>';
      return hero(pctPlano(consumo), estadoChip(consumo, esperado), `${$(tA)} de ${$(ppto)}${r.mensual ? '' : ' (prorrateado al período)'}`)
        + `<div class="insight">${ins}</div>`
        + minis([['Presupuesto', $(ppto)], ['Gastado', $(tA)], ['Disponible', $(ppto - tA)], ['Consumo esperado', pctPlano(esperado)]])
        + sec('Control por categoría') + `<div class="panel panel-flush"><div class="table-wrap"><table>
          <thead><tr><th>Categoría</th><th class="num hide-sm">Presupuesto</th><th class="num">Gastado</th><th>Consumo</th><th>Estado</th><th class="num hide-sm">Disponible</th></tr></thead>
          <tbody>${filas.map(f => {
            const col = f.pc == null || f.pc > 100 ? 'var(--crit)' : f.pc > esperado * 1.1 || f.pc > 90 ? 'var(--warn)' : 'var(--good)';
            return `<tr data-cat="${esc(f.c)}"><td><i class="swatch" style="background:${colorCat(f.c)}"></i>${esc(f.c)}</td><td class="num hide-sm">${f.p ? $(f.p) : '—'}</td><td class="num">${$(f.g)}</td>
              <td><div class="meter"><span style="width:${Math.min(100, f.pc ?? 100)}%;background:${col}"></span></div><span class="mono small">${f.pc == null ? '—' : pctPlano(f.pc)}</span></td>
              <td>${f.pc == null ? '<span class="status-chip ex">✖ Sin ppto.</span>' : estadoChip(f.pc, esperado)}</td><td class="num hide-sm">${f.p ? $(f.p - f.g) : '—'}</td></tr>`;
          }).join('')}</tbody></table></div></div>`;
    },
    montar(body) { body.querySelector('#d-ir-ppto')?.addEventListener('click', () => { cerrar(); irA('ajustes'); }); },
  };
}

/* ---------- Respaldo documental ---------- */
function drillRespaldo() {
  return {
    kicker: 'TRAZABILIDAD · RESPALDO', titulo: 'Respaldo documental',
    html() {
      const { A, tA } = contexto();
      const sin = A.filter(g => !tieneRespaldo(g)).sort((a, b) => b.monto - a.monto);
      const conF = A.length - sin.length;
      const nFoto = A.filter(g => g.imagenId).length, nCart = A.filter(deCartola).length;
      const pc = A.length ? conF / A.length * 100 : 0;
      const mSin = total(sin);
      let ins = `<p><b>${conF} de ${A.length}</b> gastos tienen respaldo (${pctPlano(pc)}): ${nFoto} con foto de boleta y ${nCart} respaldados por la cartola del banco.</p>`;
      if (sin.length) ins += `<p>Hay <b>${$(mSin)}</b> sin respaldo documental (${pctPlano(tA ? mSin / tA * 100 : 0)} del monto). Pinche un gasto para editarlo y adjuntar la boleta.</p>`;
      const pend = A.filter(g => g.comercioPendiente).length;
      if (pend) ins += `<p><b>${pend}</b> ${pend === 1 ? 'gasto tiene' : 'gastos tienen'} el comercio por identificar (marcados “● completar” en el libro).</p>`;
      const porCat = agrupar(A, g => g.categoria);
      return hero(pctPlano(pc), '', 'de los gastos con boleta o cartola')
        + `<div class="insight">${ins}</div>`
        + minis([['Con foto', num(nFoto)], ['Con cartola', num(nCart)], ['Sin respaldo', num(sin.length)], ['Monto sin respaldo', $(mSin)], ['Duplicados detectados', num(duplicados(A).length)]])
        + sec('Cobertura por categoría') + `<div class="panel panel-flush"><div class="table-wrap"><table>
          <thead><tr><th>Categoría</th><th class="num">Gastos</th><th class="num">Con respaldo</th><th>Cobertura</th></tr></thead>
          <tbody>${porCat.map(c => { const k = c.items.filter(tieneRespaldo).length, p = k / c.n * 100; return `<tr data-cat="${esc(c.clave)}"><td><i class="swatch" style="background:${colorCat(c.clave)}"></i>${esc(c.clave)}</td><td class="num">${c.n}</td><td class="num">${k}</td><td><div class="meter"><span style="width:${p}%;background:${p >= 80 ? 'var(--good)' : p >= 50 ? 'var(--warn)' : 'var(--crit)'}"></span></div><span class="mono small">${pctPlano(p)}</span></td></tr>`; }).join('')}</tbody></table></div></div>`
        + sec('Gastos sin respaldo (mayor a menor)') + `<div class="panel panel-flush">${tablaGastos(sin, { limite: 25, vacio: 'Todos los gastos tienen respaldo ✔' })}</div>`;
    },
  };
}

function duplicados(list) {
  const vistos = new Map(), out = [];
  for (const g of list) {
    const k = g.imagenHash || `${g.fecha}|${g.monto}|${(g.comercio || '').toLowerCase()}`;
    if (vistos.has(k)) out.push([vistos.get(k), g]); else vistos.set(k, g);
  }
  return out;
}

/* ---------- Categoría ---------- */
function ultimosMeses(list, n = 6) {
  const ref = new Date();
  return Array.from({ length: n }, (_, k) => {
    const d = new Date(ref.getFullYear(), ref.getMonth() - (n - 1 - k), 1);
    const a = iso(d), b = iso(new Date(d.getFullYear(), d.getMonth() + 1, 0));
    return { label: mesCorto(a), value: total(list.filter(g => enRango(g, a, b))), a, b, tipTitle: mesLargo(d.getFullYear(), d.getMonth()) };
  });
}

function drillCategoria(cat) {
  return {
    kicker: 'BAJADA · CATEGORÍA', titulo: cat,
    html() {
      const { r, A, B, tA, factor } = contexto();
      const a = A.filter(g => g.categoria === cat), b = B.filter(g => g.categoria === cat);
      const ta = total(a), tb = total(b);
      const coms = agrupar(a, g => g.comercio);
      const p = (+S.presupuestos[cat] || 0) * factor;
      let ins = `<p><b>${esc(cat)}</b> suma <b>${$(ta)}</b>, el <b>${pctPlano(tA ? ta / tA * 100 : 0)}</b> del gasto del período${tb ? `; ${sube(ta - tb)} ${pctPlano(Math.abs(varPct(ta, tb)), 1)} frente a ${esc(r.prevLabel)} (${$(tb)})` : ''}.</p>`;
      if (coms[0]) ins += `<p>El principal comercio es <b>${esc(coms[0].clave)}</b> con ${pctPlano(coms[0].total / ta * 100)} de la categoría. Ticket promedio <b>${$(ta / a.length)}</b> en ${a.length} compras.</p>`;
      if (p) ins += `<p>Presupuesto del período ${$(p)}: consumido <b>${pctPlano(ta / p * 100)}</b>.</p>`;
      const desc = descomponer(a, b, g => g.comercio).slice(0, 10);
      return hero($(ta), deltaChip(varPct(ta, tb)), `vs ${$(tb)} · ${esc(r.rotulo)}`)
        + `<div class="insight">${ins}</div>`
        + minis([['Participación', pctPlano(tA ? ta / tA * 100 : 0)], ['Transacciones', num(a.length)], ['Ticket promedio', $(a.length ? ta / a.length : 0)], ['Presupuesto', p ? $(p) : '—']])
        + sec('Tendencia últimos 6 meses') + '<div class="chart" id="d-cat-tend"></div>'
        + sec('Comercios de la categoría · variación') + tablaVariacion(desc, { dimension: 'Comercio', attr: k => `data-comercio="${esc(k)}"` })
        + sec('Movimientos') + `<div class="panel panel-flush">${tablaGastos([...a].sort(ordenReciente), { limite: 30, foot: true })}</div>`;
    },
    montar() {
      const meses = ultimosMeses(activos().filter(g => g.categoria === cat));
      const p = +S.presupuestos[cat] || 0;
      barChart(el('d-cat-tend'), {
        bars: meses.map(m => ({ ...m, color: colorCat(cat) })), fmt: $, fmtAxis: $k, height: 190,
        ref: p ? { value: p, label: `ppto ${$k(p)}` } : null,
        onClick: (i, b) => abrir(drillRango(b.a, b.b, cat)),
      });
    },
  };
}

/* ---------- Comercio ---------- */
function drillComercio(nombre) {
  return {
    kicker: 'BAJADA · COMERCIO', titulo: nombre,
    html() {
      const { r, A, B, tA } = contexto();
      const a = A.filter(g => g.comercio === nombre), b = B.filter(g => g.comercio === nombre);
      const ta = total(a), tb = total(b);
      const hist = activos().filter(g => g.comercio === nombre).sort(ordenReciente);
      const cats = agrupar(a, g => g.categoria);
      const ultima = hist[0];
      const frecuencia = a.length > 1 ? r.dias / a.length : null;
      let ins = `<p>En <b>${esc(nombre)}</b> se gastó <b>${$(ta)}</b> en ${a.length} visitas (${pctPlano(tA ? ta / tA * 100 : 0)} del gasto total)${tb ? `, ${sube(ta - tb)} ${pctPlano(Math.abs(varPct(ta, tb)), 1)} vs período anterior` : ''}.</p>`;
      if (frecuencia) ins += `<p>Frecuencia: una visita cada <b>${num(frecuencia)} días</b>. Última compra: ${ultima ? fechaLarga(ultima.fecha) : '—'}.</p>`;
      return hero($(ta), deltaChip(varPct(ta, tb)), `${a.length} visitas · ${esc(r.rotulo)}`)
        + `<div class="insight">${ins}</div>`
        + minis([['Ticket promedio', $(a.length ? ta / a.length : 0)], ['Visitas', num(a.length)], ['Histórico total', $(total(hist))], ['Categoría', esc(cats[0]?.clave || hist[0]?.categoria || '—')]])
        + sec('Tendencia últimos 6 meses') + '<div class="chart" id="d-com-tend"></div>'
        + sec('Historial de compras') + `<div class="panel panel-flush">${tablaGastos(hist, { limite: 30, foot: true })}</div>`;
    },
    montar() {
      barChart(el('d-com-tend'), {
        bars: ultimosMeses(activos().filter(g => g.comercio === nombre)).map(m => ({ ...m, color: PALETA[0] })), fmt: $, fmtAxis: $k, height: 180,
      });
    },
  };
}

/* ---------- Rango (día / semana / mes) ---------- */
function drillRango(desde, hasta, cat) {
  const titulo = desde === hasta ? fechaLarga(desde) : `${fechaCorta(desde)} – ${fechaCorta(hasta)}`;
  return {
    kicker: 'BAJADA · ' + (desde === hasta ? 'DÍA' : 'TRAMO') + (cat ? ' · ' + cat.toUpperCase() : ''), titulo,
    html() {
      const l = activos().filter(g => enRango(g, desde, hasta) && (!cat || g.categoria === cat)).sort((a, b) => b.monto - a.monto);
      const t = total(l);
      const cats = agrupar(l, g => g.categoria);
      return hero($(t), '', `${l.length} movimientos`)
        + (cats.length > 1 ? sec('Por categoría') + hbars(cats.map(c => ({ name: c.clave, value: c.total, color: colorCat(c.clave), attr: `data-cat="${esc(c.clave)}"`, extra: pctPlano(c.total / t * 100) }))) : '')
        + sec('Movimientos') + `<div class="panel panel-flush">${tablaGastos(l, { foot: true })}</div>`;
    },
  };
}

/* ---------- Ficha de un gasto (trazabilidad) ---------- */
function drillGasto(id) {
  return {
    kicker: 'FICHA · TRAZABILIDAD', titulo: 'Detalle del gasto',
    html() {
      const g = S.gastos.find(x => x.id === id);
      if (!g) return '<div class="empty">Registro no encontrado</div>';
      const hist = [...(g.historial || [])].reverse();
      return hero($(g.monto), g.anulado ? '<span class="status-chip ex">✖ Anulado</span>' : '', `${esc(g.comercio)} · ${fechaLarga(g.fecha)}`)
        + (g.anulado ? `<div class="insight"><p><b>Registro anulado.</b> Motivo: ${esc(g.motivoAnulacion || '—')}. Se excluye de los indicadores pero se conserva para auditoría.</p></div>` : '')
        + (g.imagenId ? `<img class="receipt-img" data-img="${g.imagenId}" alt="Foto de la boleta" id="d-img">` : '<div class="empty"><b>Sin foto de respaldo</b>Edite el gasto para adjuntar la boleta.</div>')
        + `<div class="row-actions">
            <button class="btn-primary" id="d-editar">Editar</button>
            ${g.anulado ? '<button class="btn-ghost" id="d-restaurar">Restaurar</button>' : '<button class="btn-ghost danger" id="d-anular">Anular</button>'}
            <button class="btn-ghost" data-cat="${esc(g.categoria)}">Ver categoría ›</button>
            <button class="btn-ghost" data-comercio="${esc(g.comercio)}">Ver comercio ›</button>
          </div>`
        + sec('Datos del registro') + `<dl class="kv">
            <dt>Folio interno</dt><dd class="mono">${folio(g)}</dd>
            <dt>Monto</dt><dd class="mono">${$(g.monto)}</dd>
            <dt>Fecha</dt><dd>${fechaLarga(g.fecha)}</dd>
            <dt>Comercio</dt><dd>${esc(g.comercio)}</dd>
            <dt>Categoría</dt><dd><i class="swatch" style="background:${colorCat(g.categoria)}"></i>${esc(g.categoria)}</dd>
            <dt>Medio de pago</dt><dd>${esc(g.medioPago || '—')}</dd>
            <dt>Documento</dt><dd>${esc(g.documento || '—')}${g.folio ? ' N° ' + esc(g.folio) : ''}</dd>
            <dt>RUT emisor</dt><dd class="mono">${esc(g.rut || '—')}</dd>
            <dt>Notas</dt><dd>${esc(g.notas || '—')}</dd>
            ${g.origen?.tipo === 'cartola' ? `<dt>Origen</dt><dd>Cartola ${esc(g.origen.banco)} ••${esc(g.origen.tarjeta || '')} · estado ${fechaLarga(g.origen.estado)}<br><span class="mono small">${esc(g.origen.descripcion)} · ref ${esc(g.origen.ref)}</span></dd>` : ''}
            ${g.conciliado ? `<dt>Conciliado</dt><dd>✔ Aparece en la cartola ${esc(g.conciliado.banco)} del ${fechaLarga(g.conciliado.estado)} (ref ${esc(g.conciliado.ref)})</dd>` : ''}
            <dt>Registrado</dt><dd>${g.creado ? fechaHora(g.creado) : '—'}${g.registradoPor ? ` · ${esc(g.registradoPor)}` : ''}</dd>
            <dt>Última modificación</dt><dd>${g.modificado ? fechaHora(g.modificado) : '—'}</dd>
            ${g.imagenHash ? `<dt>Huella SHA-256</dt><dd><span class="hash">${g.imagenHash}</span><br><button class="btn-ghost" id="d-verificar" style="margin-top:6px;padding:6px 10px;font-size:12px">Verificar integridad de la foto</button> <span id="d-verif" class="small"></span></dd>` : ''}
          </dl>`
        + sec('Bitácora de cambios') + `<ul class="timeline">${hist.map(h => `<li><div class="when">${fechaHora(h.ts)}${h.por ? ` · ${esc(h.por)}` : ''}</div><div><b>${esc(h.accion)}</b></div>${(h.cambios || []).map(c => `<div class="chg">${esc(c.campo)}: <s>${esc(c.antes)}</s> → ${esc(c.despues)}</div>`).join('')}${h.detalle ? `<div class="chg">${esc(h.detalle)}</div>` : ''}</li>`).join('') || '<li>Sin registros</li>'}</ul>`;
    },
    montar(body) {
      const g = S.gastos.find(x => x.id === id);
      if (!g) return;
      body.querySelector('#d-img')?.addEventListener('click', e => e.target.classList.toggle('zoom'));
      body.querySelector('#d-editar')?.addEventListener('click', () => { cerrar(); editar(g); });
      body.querySelector('#d-anular')?.addEventListener('click', async () => {
        const motivo = await dialogo({ titulo: 'Anular gasto', texto: 'El registro se excluye de los indicadores pero queda en la bitácora para auditoría.', campo: 'Motivo de la anulación', ok: 'Anular', peligro: true });
        if (motivo == null) return;
        g.anulado = true; g.motivoAnulacion = motivo || 'Sin motivo';
        await registrarCambio(g, 'Anulado', [], motivo);
        toast('Gasto anulado'); pintarDrawer(); render();
      });
      body.querySelector('#d-restaurar')?.addEventListener('click', async () => {
        g.anulado = false;
        await registrarCambio(g, 'Restaurado', []);
        toast('Gasto restaurado'); pintarDrawer(); render();
      });
      body.querySelector('#d-verificar')?.addEventListener('click', async () => {
        const img = await db.get('imagenes', g.imagenId);
        const h = img ? await sha256(blobDe(img)) : null;
        const ok = h && h === g.imagenHash;
        body.querySelector('#d-verif').innerHTML = ok ? '<span class="status-chip ok">✔ Íntegra: la foto no ha sido alterada</span>' : '<span class="status-chip ex">✖ La huella no coincide</span>';
      });
    },
  };
}

async function registrarCambio(g, accion, cambios, detalle) {
  g.modificado = Date.now();
  g.historial = [...(g.historial || []), { ts: g.modificado, accion, cambios, detalle, por: nubeEmail() || undefined }];
  await db.put('gastos', g);
  programarSync();
}

/* ============================================================
   Formulario de registro
   ============================================================ */
function poblarSelects() {
  el('f-categoria').innerHTML = S.categorias.map(c => `<option>${esc(c)}</option>`).join('');
  el('cat-chips').innerHTML = S.categorias.map(c => `
    <button type="button" class="cat-chip" data-valor="${esc(c)}" aria-pressed="false" style="--c:${colorCat(c)}">
      <b>${esc(c)}</b><small>${esc(KAKEBO_DESC[c] || '')}</small>
    </button>`).join('');
  el('f-medio').innerHTML = MEDIOS.map(c => `<option>${esc(c)}</option>`).join('');
  el('filtro-cat').innerHTML = '<option value="">Todas las categorías</option>' + S.categorias.map(c => `<option>${esc(c)}</option>`).join('');
  actualizarDatalist();
}
function actualizarDatalist() {
  const coms = agrupar(activos(), g => g.comercio).map(c => c.clave);
  el('dl-comercios').innerHTML = coms.map(c => `<option value="${esc(c)}">`).join('');
}

function bindForm() {
  const input = el('foto'), dz = el('dropzone');
  input.addEventListener('change', () => input.files[0] && tomarFoto(input.files[0]));
  ['dragenter', 'dragover'].forEach(t => dz.addEventListener(t, e => { e.preventDefault(); dz.classList.add('is-over'); }));
  ['dragleave', 'drop'].forEach(t => dz.addEventListener(t, e => { e.preventDefault(); dz.classList.remove('is-over'); }));
  dz.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f?.type.startsWith('image/')) tomarFoto(f); });
  el('btn-ocr').addEventListener('click', () => S.foto && ejecutarOCR());
  el('btn-quitar-foto').addEventListener('click', quitarFoto);
  el('btn-cancelar').addEventListener('click', limpiarForm);
  el('form-gasto').addEventListener('submit', e => { e.preventDefault(); guardar(); });
  el('f-monto').addEventListener('blur', () => { const v = parseMonto(el('f-monto').value); if (v > 0) el('f-monto').value = num(v); });
  el('sug-chips').addEventListener('click', e => {
    const b = e.target.closest('.sug-chip'); if (!b) return;
    el('f-comercio').value = b.dataset.nombre;
    el('f-comercio').dispatchEvent(new Event('change'));
  });
  el('cat-chips').addEventListener('click', e => {
    const b = e.target.closest('.cat-chip'); if (!b) return;
    setCategoria(b.dataset.valor); el('cat-chips').dataset.manual = '1';
  });
  el('f-comercio').addEventListener('change', () => {
    // sugiere la categoría usada la última vez en ese comercio, o por palabras clave
    if (S.editId) return;
    const nombre = el('f-comercio').value.trim().toLowerCase();
    const prev = [...activos()].sort(ordenReciente).find(g => g.comercio.toLowerCase() === nombre);
    if (prev) { el('f-medio').value = prev.medioPago; if (!el('cat-chips').dataset.manual) setCategoria(prev.categoria); return; }
    const sug = sugerirCategoria(nombre);
    if (sug && !el('cat-chips').dataset.manual) setCategoria(sug);
  });
  limpiarForm();
}

async function tomarFoto(file) {
  try {
    const { blob, w, h } = await comprimirImagen(file);
    const hash = await sha256(blob);
    if (S.foto?.url && S.foto.nueva) URL.revokeObjectURL(S.foto.url);
    S.foto = { blob, hash, w, h, url: URL.createObjectURL(blob), nueva: true };
    el('foto-preview').src = S.foto.url;
    el('foto-preview').hidden = false;
    el('dz-empty').hidden = true;
    el('btn-ocr').disabled = false;
    el('btn-quitar-foto').disabled = false;
    el('foto').value = '';
    ejecutarOCR();
  } catch (e) {
    toast('No se pudo procesar la imagen');
    console.error(e);
  }
}

function quitarFoto() {
  if (S.foto?.url && S.foto.nueva) URL.revokeObjectURL(S.foto.url);
  S.foto = null;
  el('foto-preview').hidden = true; el('foto-preview').removeAttribute('src');
  el('dz-empty').hidden = false;
  el('btn-ocr').disabled = true; el('btn-quitar-foto').disabled = true;
}

async function ejecutarOCR() {
  const bar = el('ocr-bar'), prog = el('ocr-progress'), st = el('ocr-status');
  bar.hidden = false; prog.style.width = '4%'; st.textContent = 'Cargando motor OCR…';
  el('btn-ocr').disabled = true;
  try {
    const res = await leerBoleta(S.foto.blob, p => { prog.style.width = Math.max(4, p * 100) + '%'; st.textContent = `Leyendo boleta… ${Math.round(p * 100)}%`; });
    const marcar = (id, v) => { if (v == null || v === '') return; const f = el(id); f.value = v; f.closest('.field').classList.add('is-ocr'); };
    if (res.monto) marcar('f-monto', num(res.monto));
    if (res.fecha) marcar('f-fecha', res.fecha);
    if (res.rut) marcar('f-rut', res.rut);
    if (res.folio) marcar('f-folio', res.folio);
    // Si el RUT ya se usó antes, se reutiliza el comercio corregido por usted (la app aprende).
    const rutN = r => String(r || '').replace(/[^\dkK]/g, '').toUpperCase();
    const previo = res.rut && [...activos()].sort(ordenReciente).find(g => g.rut && rutN(g.rut) === rutN(res.rut));
    if (previo) res.comercio = previo.comercio;
    if (res.comercio && !el('f-comercio').value) { marcar('f-comercio', res.comercio); el('f-comercio').dispatchEvent(new Event('change')); }
    mostrarSugerencias(previo ? [previo.comercio] : (res.candidatos || []));
    if (!previo && !el('cat-chips').dataset.manual) { const sug = sugerirCategoria(res.texto); if (sug) setCategoria(sug); }
    const n = ['monto', 'fecha', 'rut', 'folio', 'comercio'].filter(k => res[k]).length;
    prog.style.width = '100%';
    st.textContent = n ? `✔ ${n} campos detectados (resaltados). Revise antes de guardar.` : 'No se detectaron datos. Complete manualmente.';
  } catch (e) {
    st.textContent = '⚠ ' + (e.message || 'OCR no disponible') + ' — complete manualmente.';
    console.error(e);
  } finally {
    el('btn-ocr').disabled = !S.foto;
  }
}

// Botones con comercios sugeridos: los leídos en la boleta primero, luego los más frecuentes.
function mostrarSugerencias(ocr = []) {
  const frecuentes = agrupar(activos().filter(g => !g.comercioPendiente), g => g.comercio)
    .sort((a, b) => b.n - a.n).slice(0, 6).map(c => c.clave);
  const vistos = new Set();
  const items = [...ocr.map(n => ({ n, ocr: true })), ...frecuentes.map(n => ({ n }))]
    .filter(x => { const k = x.n.toLowerCase(); if (vistos.has(k)) return false; vistos.add(k); return true; })
    .slice(0, 7);
  el('sug-chips').innerHTML = items.map(x => `<button type="button" class="sug-chip${x.ocr ? ' ocr' : ''}" data-nombre="${esc(x.n)}" title="${x.ocr ? 'Leído en la boleta' : 'Comercio frecuente'}">${esc(x.n)}</button>`).join('');
  el('sug-comercio').hidden = !items.length;
}

function setCategoria(c) {
  el('f-categoria').value = c;
  el('cat-chips').querySelectorAll('.cat-chip').forEach(b => {
    const on = b.dataset.valor === c;
    b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', on);
  });
}

function limpiarForm() {
  S.editId = null;
  el('form-gasto').reset();
  quitarFoto();
  el('f-fecha').value = hoy();
  el('form-title').textContent = 'Nueva boleta';
  el('btn-guardar').textContent = 'Guardar gasto';
  el('form-alert').hidden = true;
  delete el('form-gasto').dataset.confirmado;
  el('ocr-bar').hidden = true;
  document.querySelectorAll('.field.is-ocr').forEach(f => f.classList.remove('is-ocr'));
  delete el('cat-chips').dataset.manual;
  setCategoria(S.categorias[0]);
  mostrarSugerencias();
}

async function editar(g) {
  limpiarForm();
  S.editId = g.id;
  el('form-title').textContent = `Editar ${folio(g)}`;
  el('btn-guardar').textContent = 'Guardar cambios';
  el('f-monto').value = num(g.monto);
  el('f-fecha').value = g.fecha;
  el('f-comercio').value = g.comercioPendiente ? '' : g.comercio;
  setCategoria(g.categoria); el('cat-chips').dataset.manual = '1';
  el('f-medio').value = g.medioPago || MEDIOS[0];
  el('f-doc').value = g.documento || 'Boleta';
  el('f-folio').value = g.folio || '';
  el('f-rut').value = g.rut || '';
  el('f-notas').value = g.notas || '';
  if (g.imagenId) {
    const u = await urlImagen(g.imagenId);
    if (u) {
      S.foto = { url: u, existente: g.imagenId, hash: g.imagenHash };
      el('foto-preview').src = u; el('foto-preview').hidden = false; el('dz-empty').hidden = true;
      el('btn-quitar-foto').disabled = false;
      el('btn-ocr').disabled = true;
    }
  }
  irA('registrar');
}

function leerForm() {
  return {
    monto: parseMonto(el('f-monto').value),
    fecha: el('f-fecha').value,
    comercio: el('f-comercio').value.trim().replace(/\s+/g, ' '),
    categoria: el('f-categoria').value,
    medioPago: el('f-medio').value,
    documento: el('f-doc').value,
    folio: el('f-folio').value.trim(),
    rut: el('f-rut').value.trim(),
    notas: el('f-notas').value.trim(),
  };
}

async function guardar() {
  const btn = el('btn-guardar');
  if (btn.disabled) return;
  btn.disabled = true;
  try {
    await guardarGasto();
  } catch (e) {
    console.error(e);
    avisoForm(`No se pudo guardar: ${e?.message || e}. Intente de nuevo; si persiste, guarde sin foto y adjúntela después.`);
  } finally {
    btn.disabled = false;
  }
}

function avisoForm(html) {
  const a = el('form-alert');
  a.hidden = false; a.innerHTML = html;
  a.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function guardarGasto() {
  const d = leerForm();
  if (!(d.monto > 0)) { avisoForm('Falta el <b>monto</b>. Escríbalo, por ejemplo 12.990.'); el('f-monto').focus(); return; }
  if (!d.fecha) { avisoForm('Falta la <b>fecha</b> del gasto.'); return; }
  // Sin comercio no se bloquea: queda identificado por RUT o como pendiente, para completarlo después.
  d.comercioPendiente = !d.comercio;
  if (!d.comercio) d.comercio = d.rut ? `RUT ${d.rut}` : 'Por identificar';

  // Control de duplicados (solo altas nuevas)
  const form = el('form-gasto');
  if (!S.editId && !form.dataset.confirmado) {
    const dupFoto = S.foto?.hash && activos().find(g => g.imagenHash === S.foto.hash);
    const dupDatos = activos().find(g => g.fecha === d.fecha && g.monto === d.monto && g.comercio.toLowerCase() === d.comercio.toLowerCase());
    const dup = dupFoto || dupDatos;
    if (dup) {
      avisoForm(`⚠ Posible duplicado de <b>${folio(dup)}</b> (${esc(dup.comercio)}, ${fechaCorta(dup.fecha)}, ${$(dup.monto)})${dupFoto ? ' — <b>misma foto</b>' : ''}. Pulse de nuevo para guardar igualmente.`);
      form.dataset.confirmado = '1';
      el('btn-guardar').textContent = 'Guardar de todas formas';
      return;
    }
  }

  let imagenId = null, imagenHash = null;
  if (S.foto?.blob && S.foto.nueva) {
    imagenId = uid();
    imagenHash = S.foto.hash;
    await guardarImagen({ id: imagenId, hash: imagenHash, w: S.foto.w, h: S.foto.h, creado: Date.now() }, S.foto.blob);
  } else if (S.foto?.existente) {
    imagenId = S.foto.existente; imagenHash = S.foto.hash;
  }

  const ahora = Date.now();
  let g;
  if (S.editId) {
    g = S.gastos.find(x => x.id === S.editId);
    const cambios = Object.keys(CAMPOS).filter(k => String(g[k] ?? '') !== String(d[k] ?? ''))
      .map(k => ({ campo: CAMPOS[k], antes: k === 'monto' ? $(g[k]) : (g[k] || '—'), despues: k === 'monto' ? $(d[k]) : (d[k] || '—') }));
    if (imagenId !== (g.imagenId || null)) {
      // la foto anterior se conserva en el almacén para auditoría
      cambios.push({ campo: 'Foto', antes: g.imagenHash ? g.imagenHash.slice(0, 12) + '…' : 'sin foto', despues: imagenHash ? imagenHash.slice(0, 12) + '…' : 'sin foto' });
      if (g.imagenId) g.fotosAnteriores = [...(g.fotosAnteriores || []), { id: g.imagenId, hash: g.imagenHash, hasta: ahora }];
    }
    if (!cambios.length) { toast('Sin cambios'); limpiarForm(); irA('dashboard'); return; }
    Object.assign(g, d, { imagenId, imagenHash });
    await registrarCambio(g, 'Editado', cambios);
    toast(`✔ ${folio(g)} actualizado`);
  } else {
    const seq = S.gastos.reduce((m, x) => Math.max(m, x.seq || 0), 0) + 1;
    g = { id: uid(), seq, ...d, imagenId, imagenHash, creado: ahora, modificado: ahora, historial: [{ ts: ahora, accion: 'Creado', detalle: imagenId ? 'Con foto de boleta' : 'Sin foto', por: nubeEmail() || undefined }], registradoPor: nubeEmail() || undefined };
    await db.put('gastos', g);
    programarSync();
    S.gastos.push(g);
    toast(`✔ Gasto ${folio(g)} registrado · ${$(g.monto)}`);
  }
  if (S.foto?.nueva) S.foto.nueva = false; // evita revocar la URL ya cacheada
  if (imagenId && S.foto?.url) urlCache.set(imagenId, S.foto.url);
  S.foto = null;
  actualizarDatalist();
  limpiarForm();
  irA('dashboard');
}

/* ============================================================
   Importar cartola bancaria (PDF)
   ============================================================ */
// Identificador estable de cada movimiento: reimportar la misma cartola no duplica nada.
// Incluye monto y descripción porque el banco repite códigos de referencia (p. ej. comisiones del mismo día).
const idCartola = (r, m) => {
  const clave = `${m.descripcion}|${m.valorCuota}`;
  let h = 0;
  for (const ch of clave) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return `cart-${r.tarjeta || 'x'}-${m.ref}-${m.cuota ? m.cuota.n + 'de' + m.cuota.de : '1'}-${m.fecha}-${(h >>> 0).toString(36)}`;
};

function categoriaPara(comercio, descripcion, tipo) {
  const prev = [...activos()].sort(ordenReciente).find(g => g.comercio.toLowerCase() === comercio.toLowerCase());
  if (prev) return { cat: prev.categoria, como: 'historial' };
  if (tipo === 'cargo') return { cat: 'Extras', como: 'regla' };
  const sug = sugerirCategoria(`${comercio} ${descripcion}`);
  return sug ? { cat: sug, como: 'regla' } : { cat: 'Supervivencia', como: 'revisar' };
}

// Prepara la vista previa: qué es nuevo, qué ya estaba importado y qué ya tenía boleta.
// Medios que nunca aparecen en la cartola de la tarjeta de crédito
const NO_TARJETA = new Set(['Efectivo', 'Transferencia', 'Tarjeta de débito']);
const igual = (a, b) => Math.round(a) === Math.round(b);
const primeraPalabra = t => (String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').match(/[a-z0-9]{3,}/) || [''])[0];

function prepararImportacion(r) {
  const usados = new Set();
  const manuales = activos().filter(g => !deCartola(g) && !NO_TARJETA.has(g.medioPago));
  return r.gastos.map(m => {
    const id = idCartola(r, m);
    const fila = { m, id, incluir: true, estado: 'nuevo', ...categoriaPara(m.comercio, m.descripcion, m.tipo) };
    // ya importado antes, o cuota de una compra que usted registró completa y ya se concilió
    const previo = S.gastos.find(g => g.id === id || (g.conciliado?.ref === m.ref && (igual(g.monto, m.monto) || igual(g.monto, m.montoTotal))));
    if (previo) { fila.estado = previo.id === id ? 'importado' : 'cuota-registrada'; fila.par = previo; fila.incluir = false; return fila; }
    const cerca = g => !usados.has(g.id) && Math.abs(diffDays(g.fecha, m.fecha)) <= 3;
    // 1) mismo monto; en cuotas, el monto total de la compra
    const par = manuales.find(g => cerca(g) && (igual(g.monto, m.monto) || (m.tipo === 'cuota' && igual(g.monto, m.montoTotal))));
    if (par) { usados.add(par.id); fila.estado = 'boleta'; fila.par = par; fila.incluir = false; fila.cat = par.categoria; return fila; }
    // 2) parecido: mismo comercio y monto cercano (propina, redondeo)
    const pos = manuales.find(g => cerca(g) && Math.abs(diffDays(g.fecha, m.fecha)) <= 2 && primeraPalabra(g.comercio) === primeraPalabra(m.comercio)
      && Math.abs(g.monto - m.monto) <= Math.max(1000, m.monto * 0.15));
    if (pos) { usados.add(pos.id); fila.estado = 'posible'; fila.par = pos; fila.incluir = false; fila.cat = pos.categoria; }
    return fila;
  });
}

async function importarCartola(file) {
  toast('Leyendo cartola…', 8000);
  let r;
  try {
    r = await leerCartola(file);
  } catch (e) {
    console.error(e);
    return toast('⚠ No se pudo leer el PDF: ' + (e.message || e), 5000);
  }
  el('toast').classList.remove('is-on');
  if (!r.gastos.length) return toast('⚠ No se encontraron movimientos en este PDF. Envíe el archivo para agregar su formato.', 6000);
  const filas = prepararImportacion(r);
  abrir(vistaImportacion(r, filas));
}

function vistaImportacion(r, filas) {
  const etiqueta = { nuevo: '', importado: '<span class="status-chip ok">Ya importado</span>', boleta: '' };
  const sel = (f, i) => `<select class="imp-cat" data-i="${i}" aria-label="Categoría">${S.categorias.map(c => `<option${c === f.cat ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select>`;
  const resumen = () => {
    const inc = filas.filter(f => f.incluir);
    return { n: inc.length, total: inc.reduce((s, f) => s + f.m.monto, 0) };
  };
  return {
    kicker: 'IMPORTAR · CARTOLA', titulo: `${r.banco}${r.tarjeta ? ' ••' + r.tarjeta : ''}`,
    html() {
      const nBoleta = filas.filter(f => f.estado === 'boleta' || f.estado === 'cuota-registrada').length;
      const nPosible = filas.filter(f => f.estado === 'posible').length;
      const nImp = filas.filter(f => f.estado === 'importado').length;
      const nRev = filas.filter(f => f.estado === 'nuevo' && f.como === 'revisar').length;
      const cuotas = r.gastos.filter(g => g.tipo === 'cuota');
      const { n, total: t } = resumen();
      const porCat = agrupar(filas.filter(f => f.incluir).map(f => ({ categoria: f.cat, monto: f.m.monto })), g => g.categoria);
      let ins = `<p>Período facturado <b>${r.periodo ? `${fechaLarga(r.periodo.desde)} al ${fechaLarga(r.periodo.hasta)}` : '—'}</b>: ${r.gastos.length} cargos por <b>${$(r.total)}</b>, que cuadran con el total facturado de la cartola.</p>`;
      if (cuotas.length) ins += `<p>${cuotas.length} son <b>cuotas</b>: se registra el valor de la cuota que paga este mes, no la compra completa.</p>`;
      if (nBoleta) ins += `<p><b>${nBoleta}</b> ya los tenía registrados con boleta: no se duplican, solo quedan marcados como conciliados con el banco.</p>`;
      if (nPosible) ins += `<p><b>${nPosible}</b> se parecen a gastos que ya registró, con un monto algo distinto (por ejemplo, propina). Quedan sin importar; revíselos abajo.</p>`;
      if (nImp) ins += `<p><b>${nImp}</b> ya se habían importado antes.</p>`;
      if (nRev) ins += `<p><b>${nRev}</b> comercios no se pudieron clasificar solos (marcados <span class="tag-pendiente">● revisar</span>): elija su categoría.</p>`;
      const omit = r.omitidos.length ? `<p class="muted small">No se importan: ${r.omitidos.map(o => `${esc(o.descripcion)} (${esc(o.motivo.toLowerCase())})`).join('; ')}.</p>` : '';
      return hero($(t), '', n ? `${n} ${n === 1 ? 'gasto' : 'gastos'} a importar` : 'Esta cartola ya está importada')
        + `<div class="insight">${ins}</div>${omit}`
        + (porCat.length ? hbars(porCat.map(c => ({ name: c.clave, value: c.total, color: colorCat(c.clave), extra: pctPlano(c.total / t * 100) })), '') : '')
        + `<div class="row"><button class="btn-primary" id="imp-ok" ${n ? '' : 'disabled'}>${n ? `Importar ${n} ${n === 1 ? 'gasto' : 'gastos'}` : 'Nada nuevo que importar'}</button><button class="btn-ghost" id="imp-todos">Marcar todos</button><button class="btn-ghost" id="imp-ninguno">Desmarcar todos</button></div>`
        + `<div class="panel panel-flush"><div class="table-wrap"><table class="imp-tabla">
          <thead><tr><th></th><th>Fecha</th><th>Comercio</th><th>Categoría</th><th class="num">Monto</th></tr></thead>
          <tbody>${filas.map((f, i) => `<tr class="${f.incluir ? '' : 'imp-off'}">
            <td><input type="checkbox" class="imp-chk" data-i="${i}" ${f.incluir ? 'checked' : ''} ${f.estado === 'importado' || f.estado === 'cuota-registrada' ? 'disabled' : ''} aria-label="Incluir"></td>
            <td class="mono">${fechaCorta(f.m.fechaGasto)}</td>
            <td><div>${esc(f.m.comercio)}${f.estado === 'nuevo' && f.como === 'revisar' ? '<span class="tag-pendiente">● revisar</span>' : ''}</div>
              <div class="id">${esc(f.m.descripcion)}${f.m.tipo === 'cuota' ? ` · cuota ${f.m.cuota.n}/${f.m.cuota.de} de ${$(f.m.montoTotal)}` : ''}</div>
              ${f.estado === 'boleta' ? `<div class="small" style="color:var(--good)">✔ Ya registrado: ${folio(f.par)} · ${esc(f.par.comercio)} ${$(f.par.monto)}${f.m.tipo === 'cuota' && !igual(f.par.monto, f.m.monto) ? ' (compra completa)' : ''}. No se duplica.</div>` : ''}
              ${f.estado === 'posible' ? `<div class="small" style="color:var(--warn)">¿Es el mismo que ${folio(f.par)} · ${esc(f.par.comercio)} ${$(f.par.monto)}? Queda sin importar; márquelo si es otro gasto.</div>` : ''}
              ${f.estado === 'cuota-registrada' ? `<div class="small" style="color:var(--good)">✔ Cuota de una compra que ya registró completa (${folio(f.par)}).</div>` : ''}${etiqueta[f.estado] || ''}</td>
            <td>${f.estado === 'importado' || f.estado === 'cuota-registrada' ? '' : sel(f, i)}</td>
            <td class="num">${$(f.m.monto)}</td></tr>`).join('')}</tbody></table></div></div>`;
    },
    montar(body) {
      const refrescar = () => { const y = body.scrollTop; pintarDrawer(); el('drawer-body').scrollTop = y; };
      body.querySelectorAll('.imp-chk').forEach(c => c.addEventListener('change', () => { filas[c.dataset.i].incluir = c.checked; refrescar(); }));
      body.querySelectorAll('.imp-cat').forEach(c => c.addEventListener('change', () => { const f = filas[c.dataset.i]; f.cat = c.value; f.como = 'usuario'; refrescar(); }));
      body.querySelector('#imp-todos').addEventListener('click', () => { filas.forEach(f => { if (f.estado === 'nuevo') f.incluir = true; }); refrescar(); });
      body.querySelector('#imp-ninguno').addEventListener('click', () => { filas.forEach(f => { if (f.estado === 'nuevo') f.incluir = false; }); refrescar(); });
      body.querySelector('#imp-ok').addEventListener('click', async e => {
        e.currentTarget.disabled = true;
        const n = await confirmarImportacion(r, filas);
        cerrar();
        toast(`✔ ${n.creados} gastos importados${n.conciliados ? ` · ${n.conciliados} conciliados con boleta` : ''}`, 4000);
        irA('dashboard');
      });
    },
  };
}

// Qué estados de cuenta están cargados, por tarjeta y mes de cierre, en los últimos 12 meses.
function coberturaCartolas() {
  const tarjetas = new Map();
  for (const g of S.gastos) {
    const o = g.origen;
    if (o?.tipo !== 'cartola' || !o.estado) continue;
    const k = `${o.banco}${o.tarjeta ? ' ••' + o.tarjeta : ''}`;
    if (!tarjetas.has(k)) tarjetas.set(k, new Map());
    const mes = o.estado.slice(0, 7);
    const m = tarjetas.get(k);
    if (!m.has(mes)) m.set(mes, { estado: o.estado, n: 0, total: 0 });
    const e = m.get(mes); e.n++; e.total += g.anulado ? 0 : g.monto;
  }
  const hoyD = new Date();
  const meses = Array.from({ length: 12 }, (_, i) => iso(new Date(hoyD.getFullYear(), hoyD.getMonth() - i, 1)).slice(0, 7));
  return { tarjetas, meses };
}

function htmlCobertura() {
  const { tarjetas, meses } = coberturaCartolas();
  if (!tarjetas.size) return `<div class="empty"><b>Aún no ha cargado cartolas</b>Importe el estado de cuenta en PDF desde Registrar → Importar cartola. Conviene partir por los últimos 3 a 12 meses.</div>`;
  const mesActual = meses[0];
  return [...tarjetas.entries()].map(([k, m]) => {
    const primero = [...m.keys()].sort()[0];
    const faltan = meses.filter(x => x !== mesActual && x > primero && !m.has(x));
    const previos = meses.filter(x => x < primero).length;
    return `<div class="cob-tarjeta">
      <div class="cob-head"><b>${esc(k)}</b><span class="muted small">${m.size} ${m.size === 1 ? 'cartola cargada' : 'cartolas cargadas'} · ${faltan.length ? `faltan ${faltan.length} desde ${mesCorto(primero + '-01')}` : `completo desde ${mesCorto(primero + '-01')} ✔`}${previos ? ` · puede sumar ${previos} meses anteriores para ver la tendencia del año` : ''}</span></div>
      <div class="cob-meses">${[...meses].reverse().map(x => {
        const e = m.get(x), nombre = mesCorto(x + '-01');
        if (e) return `<div class="cob-mes ok" title="Estado de cuenta al ${fechaLarga(e.estado)}"><b>${nombre}</b><span>✔ ${e.n} mov.</span><span>${$k(e.total)}</span></div>`;
        if (x === mesActual) return `<div class="cob-mes curso"><b>${nombre}</b><span>en curso</span></div>`;
        return `<div class="cob-mes falta ${x < primero ? 'antes' : ''}"><b>${nombre}</b><span>${x < primero ? 'anterior' : '✖ falta'}</span></div>`;
      }).join('')}</div>
      ${faltan.length ? `<p class="small" style="margin:6px 0 0">Para completar: descargue del banco los estados de cuenta que cierran en <b>${faltan.map(x => mesLargo(+x.slice(0, 4), +x.slice(5) - 1)).join(', ')}</b>.</p>` : ''}
    </div>`;
  }).join('');
}

function drillCobertura() {
  return {
    kicker: 'CARTOLAS · COBERTURA', titulo: '¿Qué cartolas me faltan?',
    html: () => `<div class="insight"><p>Cada tarjeta tiene <b>un estado de cuenta al mes</b>. Aquí ve cuáles ya cargó (✔) y cuáles faltan (✖) en los últimos 12 meses. Los meses anteriores a su primera cartola son opcionales: cárguelos si quiere ver la tendencia del año.</p><p>Si tiene <b>otra tarjeta o cuenta corriente</b>, cárguela también: aparecerá como una fila nueva. Si alguna cartola no se lee bien, envíela para agregar su formato.</p></div>`
      + htmlCobertura()
      + `<div class="row"><button class="btn-primary" data-importar-drawer>Importar cartola (PDF)</button></div>`,
    montar(body) { body.querySelector('[data-importar-drawer]')?.addEventListener('click', () => el('cartola-pdf').click()); },
  };
}

async function confirmarImportacion(r, filas) {
  const ahora = Date.now();
  let seq = S.gastos.reduce((m, x) => Math.max(m, x.seq || 0), 0);
  let creados = 0, conciliados = 0;
  const por = nubeEmail() || undefined;
  const origenDe = m => ({ tipo: 'cartola', banco: r.banco, tarjeta: r.tarjeta, estado: r.fechaEstado, periodo: r.periodo, ref: m.ref, descripcion: m.descripcion, fechaOperacion: m.fecha, cuota: m.cuota, montoOperacion: m.montoTotal });
  for (const f of filas) {
    const m = f.m;
    if ((f.estado === 'boleta' || f.estado === 'posible') && !f.incluir) {
      // conciliación: el gasto registrado a mano aparece en el banco; no se crea otro
      const g = S.gastos.find(x => x.id === f.par.id);
      if (g && !g.conciliado) {
        g.conciliado = { banco: r.banco, estado: r.fechaEstado, ref: m.ref };
        g.modificado = ahora;
        g.historial = [...(g.historial || []), { ts: ahora, accion: 'Conciliado con cartola', detalle: `${r.banco} ••${r.tarjeta || ''} · ${m.descripcion}`, por }];
        await db.put('gastos', g);
        conciliados++;
      }
      continue;
    }
    if (!f.incluir || f.estado === 'importado' || f.estado === 'cuota-registrada') continue;
    const notas = [`${r.banco}${r.tarjeta ? ' ••' + r.tarjeta : ''} · estado de cuenta ${fechaCorta(r.fechaEstado)}`,
      m.tipo === 'cuota' ? `cuota ${m.cuota.n}/${m.cuota.de} de compra del ${fechaCorta(m.fecha)} por ${$(m.montoTotal)}` : ''].filter(Boolean).join(' · ');
    const g = {
      id: f.id, seq: ++seq, monto: m.monto, fecha: m.fechaGasto, comercio: m.comercio, categoria: f.cat,
      medioPago: 'Tarjeta de crédito', documento: 'Cartola', folio: '', rut: '', notas,
      origen: origenDe(m), imagenId: null, imagenHash: null, creado: ahora, modificado: ahora, registradoPor: por,
      historial: [{ ts: ahora, accion: 'Creado', detalle: `Importado desde cartola ${r.banco} (estado ${fechaCorta(r.fechaEstado)})`, por }],
    };
    await db.put('gastos', g);
    creados++;
  }
  await cargar();
  actualizarDatalist();
  render();
  programarSync(300);
  return { creados, conciliados };
}

/* ============================================================
   Libro de gastos
   ============================================================ */
function bindImportar() {
  document.querySelectorAll('[data-cobertura]').forEach(b => b.addEventListener('click', () => abrir(drillCobertura())));
  document.querySelectorAll('[data-importar]').forEach(b => b.addEventListener('click', () => el('cartola-pdf').click()));
  el('cartola-pdf').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) importarCartola(f); });
}

function bindLibro() {
  ['q', 'filtro-cat', 'filtro-mes', 'filtro-anulados'].forEach(id => el(id).addEventListener('input', renderLibro));
}

function renderLibro() {
  const q = el('q').value.trim().toLowerCase();
  const cat = el('filtro-cat').value;
  const mes = el('filtro-mes').value;
  const verAnul = el('filtro-anulados').checked;
  const l = S.gastos.filter(g =>
    (verAnul || !g.anulado) &&
    (!cat || g.categoria === cat) &&
    (!mes || g.fecha.startsWith(mes)) &&
    (!q || [g.comercio, g.folio, g.rut, g.notas, folio(g), g.categoria, g.medioPago].join(' ').toLowerCase().includes(q))
  ).sort(ordenReciente);
  const vivos = l.filter(g => !g.anulado);
  el('libro-resumen').textContent = `${vivos.length} registros · ${$(total(vivos))}`;
  el('libro-tabla').innerHTML = tablaGastos(l, { foot: true, limite: 500, vacio: 'Sin resultados para los filtros aplicados' });
  hidratarImgs(el('libro-tabla'));
}

/* ============================================================
   Ajustes: presupuesto, respaldo, demo
   ============================================================ */
function bindAjustes() {
  el('btn-guardar-ppto').addEventListener('click', async () => {
    const p = {};
    el('presupuestos').querySelectorAll('input').forEach(i => { const v = parseMonto(i.value); if (v > 0) p[i.dataset.cat] = v; });
    S.presupuestos = p;
    await setAjuste('presupuestos', p);
    await setAjuste('presupuestosAt', Date.now());
    programarSync(300);
    toast('✔ Presupuesto guardado');
    renderAjustes();
  });
  el('btn-export-json').addEventListener('click', exportarJSON);
  el('btn-export-csv').addEventListener('click', exportarCSV);
  el('import-json').addEventListener('change', importarJSON);
  el('btn-demo').addEventListener('click', cargarDemo);
  el('btn-demo-del').addEventListener('click', borrarDemo);
}

async function renderAjustes() {
  renderNube();
  el('cobertura-cartolas').innerHTML = htmlCobertura();
  const tot = Object.values(S.presupuestos).reduce((s, v) => s + (+v || 0), 0);
  el('presupuestos').innerHTML = S.categorias.map(c => `
    <label class="field"><span><i class="swatch" style="background:${colorCat(c)}"></i>${esc(c)}</span>
    <input type="text" inputmode="numeric" data-cat="${esc(c)}" value="${S.presupuestos[c] ? num(S.presupuestos[c]) : ''}" placeholder="0"></label>`).join('')
    + `<div class="field field-full"><span>Total mensual</span><div class="mono" style="font-size:22px;font-weight:700">${$(tot)}</div></div>`;
  const u = await estimarUso();
  const nImg = (await db.all('imagenes')).length;
  const ultimo = await getAjuste('ultimoRespaldo', null);
  el('storage-info').innerHTML = `Modo: ${instalada() ? 'app instalada ✔' : 'navegador'} · Guardado protegido: ${S.persistente ? 'sí ✔' : 'no garantizado'} · Último respaldo: ${ultimo ? fechaHora(ultimo) : 'nunca'}<br>${S.gastos.length} gastos · ${nImg} fotos${u ? ` · ${(u.usage / 1048576).toFixed(1)} MB usados de ${(u.quota / 1073741824).toFixed(1)} GB disponibles` : ''}`;
}

async function exportarJSON() {
  toast('Preparando respaldo…');
  const imgs = await db.all('imagenes');
  const imagenes = [];
  for (const i of imgs) imagenes.push({ id: i.id, hash: i.hash, w: i.w, h: i.h, creado: i.creado, data: await blobToDataURL(blobDe(i)) });
  const payload = { app: 'pupo-gastos', version: 1, exportado: new Date().toISOString(), ajustes: { categorias: S.categorias, presupuestos: S.presupuestos }, gastos: S.gastos, imagenes };
  const nombre = `pupo-respaldo-${hoy()}.json`, texto = JSON.stringify(payload);
  let res = await guardarArchivo(nombre, texto, 'application/json');
  if (res === 'requiere-toque') {
    // el navegador pide un toque directo para abrir el menú Compartir
    if (await dialogo({ titulo: 'Respaldo listo', texto: `${S.gastos.length} gastos y ${imagenes.length} fotos. Toque Guardar y elija "Guardar en Archivos" (iCloud Drive) o envíelo a su correo.`, ok: 'Guardar respaldo' }) == null) return;
    res = await guardarArchivo(nombre, texto, 'application/json');
  }
  if (res === 'cancelado') return toast('Respaldo cancelado');
  await setAjuste('ultimoRespaldo', Date.now());
  toast('✔ Respaldo guardado');
  revisarAlmacen();
  if (el('view-ajustes').classList.contains('is-active')) renderAjustes();
}

function exportarCSV() {
  const cols = ['Folio interno', 'Fecha', 'Comercio', 'Categoría', 'Monto', 'Medio de pago', 'Documento', 'N° folio', 'RUT', 'Notas', 'Con foto', 'Huella SHA-256', 'Estado', 'Registrado', 'Modificado'];
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [...S.gastos].sort(ordenReciente).map(g => [
    folio(g), g.fecha, g.comercio, g.categoria, Math.round(g.monto), g.medioPago, g.documento, g.folio, g.rut, g.notas,
    g.imagenId ? 'Sí' : 'No', g.imagenHash || '', g.anulado ? 'Anulado' : 'Vigente',
    g.creado ? new Date(g.creado).toISOString() : '', g.modificado ? new Date(g.modificado).toISOString() : '',
  ].map(q).join(';'));
  guardarArchivo(`pupo-libro-${hoy()}.csv`, '﻿' + [cols.map(q).join(';'), ...rows].join('\r\n'), 'text/csv;charset=utf-8');
}

async function importarJSON(e) {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (data.app !== 'pupo-gastos' || !Array.isArray(data.gastos)) throw new Error('Archivo no reconocido');
    if (await dialogo({ titulo: 'Restaurar respaldo', texto: `Se restaurarán ${data.gastos.length} gastos y ${data.imagenes?.length || 0} fotos. Los registros con el mismo ID se sobrescriben.`, ok: 'Restaurar' }) == null) return;
    for (const i of data.imagenes || []) await db.put('imagenes', { id: i.id, hash: i.hash, w: i.w, h: i.h, creado: i.creado, blob: await dataURLToBlob(i.data) });
    for (const g of data.gastos) { delete g.syncAt; delete g.imagenNube; await db.put('gastos', g); }
    if (data.ajustes?.presupuestos) await setAjuste('presupuestos', data.ajustes.presupuestos);
    if (data.ajustes?.categorias) await setAjuste('categorias', data.ajustes.categorias);
    await cargar(); poblarSelects(); render(); programarSync(300);
    toast(`✔ Respaldo restaurado: ${data.gastos.length} gastos`);
  } catch (err) {
    toast('⚠ No se pudo restaurar: ' + err.message, 4000);
  }
}

/* ---------- Datos demo ---------- */
const DEMO = {
  sup1: { cat: 'Supervivencia', coms: ['Jumbo', 'Líder', 'Unimarc', 'Tottus', 'Santa Isabel'], min: 8000, max: 95000, freq: 0.55 },
  sup2: { cat: 'Supervivencia', coms: ['Copec', 'Shell', 'Uber', 'Cabify', 'Autopista Central'], min: 3000, max: 55000, freq: 0.5 },
  sup3: { cat: 'Supervivencia', coms: ['Cruz Verde', 'Salcobrand', 'Enel', 'Aguas Andinas', 'Movistar', 'Metrogas'], min: 4000, max: 70000, freq: 0.2 },
  ocio: { cat: 'Ocio y vicio', coms: ['Starbucks', 'Juan Maestro', 'Tanta', 'Liguria', 'Doggis', 'Cinemark', 'Netflix', 'Rappi'], min: 4500, max: 48000, freq: 0.55 },
  cult: { cat: 'Cultura', coms: ['Librería Antártica', 'Buscalibre', 'Teatro Municipal', 'Coursera', 'Museo de Bellas Artes'], min: 5000, max: 60000, freq: 0.1 },
  extr: { cat: 'Extras', coms: ['Sodimac', 'Falabella', 'Paris', 'Correos de Chile', 'Veterinaria Los Leones'], min: 5000, max: 120000, freq: 0.12 },
};

function rnd(min, max) { return min + Math.random() * (max - min); }
function rutFalso() { return `${Math.floor(rnd(76, 99))}.${Math.floor(rnd(100, 999))}.${Math.floor(rnd(100, 999))}-${Math.floor(rnd(0, 9))}`; }

async function boletaFalsa(g) {
  const c = document.createElement('canvas');
  c.width = 300; c.height = 460;
  const x = c.getContext('2d');
  x.fillStyle = '#f4f1ea'; x.fillRect(0, 0, 300, 460);
  x.fillStyle = '#222'; x.textAlign = 'center';
  x.font = 'bold 18px monospace'; x.fillText(g.comercio.toUpperCase(), 150, 40);
  x.font = '12px monospace';
  x.fillText(`R.U.T.: ${g.rut}`, 150, 62);
  x.fillText('BOLETA ELECTRONICA', 150, 84);
  x.fillText(`N° ${g.folio}`, 150, 100);
  const [y, m, d] = g.fecha.split('-');
  x.fillText(`FECHA: ${d}/${m}/${y}`, 150, 122);
  x.textAlign = 'left';
  let rest = g.monto, yy = 160;
  const n = 2 + Math.floor(Math.random() * 4);
  for (let i = 0; i < n; i++) {
    const v = i === n - 1 ? rest : Math.round(rest * rnd(0.15, 0.5));
    rest -= v;
    x.fillText(`ITEM ${String(i + 1).padStart(2, '0')}`, 24, yy);
    x.textAlign = 'right'; x.fillText(num(v), 276, yy); x.textAlign = 'left';
    yy += 22;
  }
  x.fillText('-'.repeat(34), 24, yy); yy += 26;
  x.font = 'bold 16px monospace';
  x.fillText('TOTAL', 24, yy); x.textAlign = 'right'; x.fillText('$' + num(g.monto), 276, yy);
  x.textAlign = 'center'; x.font = '11px monospace'; x.fillText('Timbre Electrónico SII', 150, 420);
  x.fillText('Verifique documento: www.sii.cl', 150, 438);
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.6));
  return { blob, hash: await sha256(blob) };
}

async function cargarDemo() {
  if (S.gastos.some(g => g.demo) && await dialogo({ titulo: 'Datos demo', texto: 'Ya hay datos demo cargados. ¿Agregar otro lote?', ok: 'Agregar' }) == null) return;
  toast('Generando datos demo…', 6000);
  const fin = hoy(), ini = addDays(fin, -183);
  let seq = S.gastos.reduce((m, x) => Math.max(m, x.seq || 0), 0);
  const nuevos = [];
  for (let f = ini; f <= fin; f = addDays(f, 1)) {
    const dow = toDate(f).getDay();
    for (const cfg of Object.values(DEMO)) {
      const cat = cfg.cat;
      const pFin = (dow === 5 || dow === 6) && cat === 'Ocio y vicio' ? 1.8 : 1;
      if (Math.random() < cfg.freq * pFin * 0.55) {
        const sesgo = Math.pow(Math.random(), 2.2);
        const monto = Math.round((cfg.min + sesgo * (cfg.max - cfg.min)) / 10) * 10;
        const ts = toDate(f).getTime() + rnd(8, 22) * 3600000;
        nuevos.push({
          id: uid(), seq: ++seq, demo: true, monto, fecha: f, comercio: cfg.coms[Math.floor(Math.random() * cfg.coms.length)], categoria: cat,
          medioPago: MEDIOS[Math.floor(Math.pow(Math.random(), 1.5) * 4)], documento: 'Boleta', folio: String(Math.floor(rnd(100000, 9999999))), rut: rutFalso(), notas: '',
          creado: ts, modificado: ts, historial: [{ ts, accion: 'Creado', detalle: 'Dato de demostración' }],
        });
      }
    }
  }
  const desdeFotos = addDays(fin, -75);
  for (const g of nuevos) {
    if (g.fecha >= desdeFotos && Math.random() < 0.82) {
      const { blob, hash } = await boletaFalsa(g);
      g.imagenId = uid(); g.imagenHash = hash;
      await guardarImagen({ id: g.imagenId, hash, w: 300, h: 460, creado: g.creado }, blob);
    }
    await db.put('gastos', g);
  }
  if (!Object.keys(S.presupuestos).length) {
    S.presupuestos = { 'Supervivencia': 820000, 'Ocio y vicio': 260000, 'Cultura': 60000, 'Extras': 120000 };
    await setAjuste('presupuestos', S.presupuestos);
  }
  await cargar(); actualizarDatalist();
  toast(`✔ ${nuevos.length} gastos demo cargados`);
  irA('dashboard');
}

async function borrarDemo() {
  const demo = S.gastos.filter(g => g.demo);
  if (!demo.length) return toast('No hay datos demo');
  if (await dialogo({ titulo: 'Eliminar datos demo', texto: `Se eliminarán ${demo.length} gastos demo. Sus registros reales no se tocan.`, ok: 'Eliminar', peligro: true }) == null) return;
  for (const g of demo) {
    if (g.imagenId) { await db.del('imagenes', g.imagenId); urlCache.delete(g.imagenId); }
    await db.del('gastos', g.id);
  }
  await cargar(); actualizarDatalist(); render();
  toast('✔ Datos demo eliminados');
}

init();
