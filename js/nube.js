// Sincronización con Supabase: cuenta, libro (personal o compartido), gastos y fotos.
// La app sigue funcionando sin conexión: el teléfono guarda primero y sube cuando puede.
import { db, getAjuste, setAjuste } from './db.js';
import { NUBE } from './config.js';

const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/dist/umd/supabase.js';
const BUCKET = 'boletas';
const LOTE = 200;

let sb = null;
let usuario = null;
let libro = null;
let sincronizando = null;
let siguiente = null;
const oyentes = new Set();
const clavePull = () => `nube.ultimoPull.${libro.id}`;
const estado = { fase: 'local', pendientes: 0, ultima: null, error: null };

export const nubeEstado = () => ({ ...estado, email: usuario?.email || null, libro, configurada: !!sb });
export const nubeEmail = () => usuario?.email || null;
export const alCambiar = fn => { oyentes.add(fn); return () => oyentes.delete(fn); };
function avisar(cambios = {}) {
  Object.assign(estado, cambios);
  oyentes.forEach(fn => { try { fn(nubeEstado()); } catch (e) { console.error(e); } });
}

function cargarScriptNube(src) {
  return new Promise((res, rej) => {
    if (window.supabase?.createClient) return res();
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = res; s.onerror = () => rej(new Error('No se pudo cargar el conector de la nube (¿sin conexión?)'));
    document.head.appendChild(s);
  });
}

export async function configNube() {
  const local = await getAjuste('nube.config', null);
  const url = (local?.url || NUBE.url || '').trim();
  const anonKey = (local?.anonKey || NUBE.anonKey || '').trim();
  return url && anonKey ? { url, anonKey, desdeAjustes: !!local?.url } : null;
}

export async function guardarConfigNube(url, anonKey) {
  await setAjuste('nube.config', url ? { url: url.trim().replace(/\/+$/, ''), anonKey: anonKey.trim() } : null);
  sb = null; usuario = null; libro = null;
  return iniciarNube();
}

// Conecta con Supabase si hay configuración; recupera la sesión guardada.
export async function iniciarNube() {
  const cfg = await configNube();
  if (!cfg) { avisar({ fase: 'local', error: null }); return nubeEstado(); }
  try {
    await cargarScriptNube(SUPABASE_JS);
    sb = window.supabase.createClient(cfg.url, cfg.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'pupo-auth', detectSessionInUrl: true },
    });
    const { data } = await sb.auth.getSession();
    usuario = data.session?.user || null;
    sb.auth.onAuthStateChange((_ev, ses) => { usuario = ses?.user || null; if (!usuario) libro = null; avisar(); });
    if (usuario) await cargarLibro();
    await contarPendientes();
    avisar({ fase: usuario ? 'conectada' : 'sin-sesion', error: null, ultima: await getAjuste('nube.ultimaSync', null) });
  } catch (e) {
    console.error(e);
    avisar({ fase: 'error', error: e.message });
  }
  return nubeEstado();
}

function traducirError(e) {
  const m = e?.message || String(e);
  if (/Invalid login credentials/i.test(m)) return 'Correo o contraseña incorrectos.';
  if (/Email not confirmed/i.test(m)) return 'Falta confirmar el correo: abra el mensaje que le enviamos y pulse el enlace.';
  if (/already registered|already exists/i.test(m)) return 'Ese correo ya tiene cuenta. Use "Entrar".';
  if (/Password should be at least/i.test(m)) return 'La contraseña debe tener al menos 6 caracteres.';
  if (/Failed to fetch|NetworkError|network/i.test(m)) return 'Sin conexión con la nube. Revise internet e intente de nuevo.';
  return m;
}

export async function entrar(email, clave) {
  if (!sb) throw new Error('La nube no está configurada.');
  const { data, error } = await sb.auth.signInWithPassword({ email: email.trim(), password: clave });
  if (error) throw new Error(traducirError(error));
  usuario = data.user;
  await cargarLibro();
  avisar({ fase: 'conectada', error: null });
  return nubeEstado();
}

export async function registrarse(email, clave) {
  if (!sb) throw new Error('La nube no está configurada.');
  const { data, error } = await sb.auth.signUp({ email: email.trim(), password: clave, options: { emailRedirectTo: location.origin + location.pathname } });
  if (error) throw new Error(traducirError(error));
  if (!data.session) return { confirmar: true };
  usuario = data.user;
  await cargarLibro();
  avisar({ fase: 'conectada', error: null });
  return { confirmar: false };
}

export async function salir() {
  if (sb) await sb.auth.signOut();
  usuario = null; libro = null;
  await setAjuste('nube.libro', null);
  avisar({ fase: sb ? 'sin-sesion' : 'local' });
}

// Libro activo: el guardado en este equipo, o el primero del usuario, o uno nuevo.
async function cargarLibro() {
  const { data, error } = await sb.from('miembros').select('libro_id, rol, libros(id, nombre, codigo, ajustes)').eq('user_id', usuario.id);
  if (error) throw new Error(traducirError(error));
  const guardado = await getAjuste('nube.libro', null);
  let fila = data.find(m => m.libro_id === guardado) || data[0];
  if (!fila) {
    const { data: nuevo, error: e2 } = await sb.rpc('crear_libro', { p_nombre: 'Mis gastos' });
    if (e2) throw new Error(traducirError(e2));
    libro = { id: nuevo.id, nombre: nuevo.nombre, codigo: nuevo.codigo, ajustes: nuevo.ajustes, rol: 'dueño' };
  } else {
    libro = { ...fila.libros, rol: fila.rol };
  }
  if (guardado && guardado !== libro.id) {
    // Libro distinto al que tenía este equipo: se suben a él los gastos locales.
    await marcarTodoPendiente();
  }
  await setAjuste('nube.libro', libro.id);
  const { count } = await sb.from('miembros').select('user_id', { count: 'exact', head: true }).eq('libro_id', libro.id);
  libro.miembros = count || 1;
}

async function marcarTodoPendiente() {
  for (const g of await db.all('gastos')) {
    if (g.demo || !g.syncAt) continue;
    delete g.syncAt; delete g.imagenNube;
    await db.put('gastos', g);
  }
}

export async function unirseALibro(codigo) {
  if (!sb || !usuario) throw new Error('Inicie sesión primero.');
  const { data, error } = await sb.rpc('unirse_libro', { p_codigo: codigo });
  if (error) throw new Error(/no válido/i.test(error.message) ? 'Ese código no corresponde a ningún libro.' : traducirError(error));
  await setAjuste('nube.libro', data.id);
  await setAjuste(`nube.ultimoPull.${data.id}`, null);
  await marcarTodoPendiente();
  await cargarLibro();
  avisar();
  return libro;
}

export async function renombrarLibro(nombre) {
  if (!libro) return;
  const { error } = await sb.from('libros').update({ nombre }).eq('id', libro.id);
  if (error) throw new Error(traducirError(error));
  libro.nombre = nombre;
  avisar();
}

const esPendiente = g => !g.demo && g.syncAt !== g.modificado;

async function contarPendientes() {
  const n = (await db.all('gastos')).filter(esPendiente).length;
  estado.pendientes = n;
  return n;
}

/* ---------- Sincronización ---------- */

// Baja cambios del servidor, sube los locales pendientes y las fotos. Devuelve cuántos registros cambiaron localmente.
export function sincronizar() {
  if (!sb || !usuario || !libro) return Promise.resolve({ ok: false, cambios: 0 });
  // Si ya hay una en curso, se encadena otra para no perder cambios recientes (p. ej. al cambiar de libro).
  if (sincronizando) return (siguiente ||= sincronizando.then(() => { siguiente = null; return sincronizar(); }));
  sincronizando = (async () => {
    avisar({ fase: 'sincronizando', error: null });
    try {
      const cambios = await bajar();
      await subirAjustes();
      await subir();
      const ahora = Date.now();
      await setAjuste('nube.ultimaSync', ahora);
      await contarPendientes();
      avisar({ fase: 'conectada', ultima: ahora, error: null });
      return { ok: true, cambios };
    } catch (e) {
      console.error(e);
      await contarPendientes();
      avisar({ fase: 'error', error: traducirError(e) });
      return { ok: false, cambios: 0, error: traducirError(e) };
    } finally {
      sincronizando = null;
    }
  })();
  return sincronizando;
}

async function bajar() {
  const libroId = libro.id;
  const desde = await getAjuste(clavePull(), null);
  let cambios = 0, maxTs = desde, pagina = 0;
  for (;;) {
    let q = sb.from('gastos').select('id, datos, modificado, actualizado').eq('libro_id', libroId)
      .order('actualizado', { ascending: true }).range(pagina * 1000, pagina * 1000 + 999);
    if (desde) q = q.gte('actualizado', desde);
    const { data, error } = await q;
    if (error) throw error;
    for (const fila of data) {
      const local = await db.get('gastos', fila.id);
      if (!local || fila.modificado > (local.modificado || 0)) {
        const g = { ...fila.datos, id: fila.id, syncAt: fila.modificado, imagenNube: !!fila.datos.imagenId };
        // conserva la foto local si ya la teníamos
        await db.put('gastos', g);
        cambios++;
      } else if (fila.modificado === local.modificado && local.syncAt !== local.modificado) {
        local.syncAt = local.modificado;
        await db.put('gastos', local);
      }
      if (!maxTs || fila.actualizado > maxTs) maxTs = fila.actualizado;
    }
    if (data.length < 1000) break;
    pagina++;
  }
  if (maxTs) await setAjuste(`nube.ultimoPull.${libroId}`, maxTs);

  // Presupuestos compartidos del libro
  const { data: lib, error } = await sb.from('libros').select('nombre, codigo, ajustes').eq('id', libro.id).single();
  if (error) throw error;
  Object.assign(libro, lib);
  const remoto = lib.ajustes?.presupuestos;
  const remotoTs = lib.ajustes?.presupuestosAt || 0;
  const localTs = await getAjuste('presupuestosAt', 0);
  if (remoto && remotoTs > localTs) {
    await setAjuste('presupuestos', remoto);
    await setAjuste('presupuestosAt', remotoTs);
    cambios++;
  }
  return cambios;
}

async function subirAjustes() {
  const localTs = await getAjuste('presupuestosAt', 0);
  if (!localTs || localTs <= (libro.ajustes?.presupuestosAt || 0)) return;
  const ajustes = { ...(libro.ajustes || {}), presupuestos: await getAjuste('presupuestos', {}), presupuestosAt: localTs };
  const { error } = await sb.from('libros').update({ ajustes }).eq('id', libro.id);
  if (error) throw error;
  libro.ajustes = ajustes;
}

async function subir() {
  const pendientes = (await db.all('gastos')).filter(esPendiente);
  // 1) fotos primero, para que el registro nunca apunte a una foto que no está en la nube
  for (const g of pendientes) {
    if (!g.imagenId || g.imagenNube) continue;
    const img = await db.get('imagenes', g.imagenId);
    if (!img) continue;
    const blob = img.blob || new Blob([img.buf], { type: img.type || 'image/jpeg' });
    const { error } = await sb.storage.from(BUCKET).upload(`${libro.id}/${g.imagenId}.jpg`, blob, { upsert: true, contentType: 'image/jpeg' });
    if (error && !/exists|Duplicate/i.test(error.message)) throw error;
    g.imagenNube = true;
  }
  // 2) registros por lotes
  for (let i = 0; i < pendientes.length; i += LOTE) {
    const lote = pendientes.slice(i, i + LOTE);
    const filas = lote.map(g => {
      const { syncAt, ...datos } = g;
      return { id: g.id, libro_id: libro.id, datos, modificado: g.modificado || g.creado || Date.now() };
    });
    const { error } = await sb.from('gastos').upsert(filas, { onConflict: 'id' });
    if (error) throw error;
    for (const g of lote) {
      g.syncAt = g.modificado;
      await db.put('gastos', g);
    }
  }
}

// Descarga una foto que no está en este equipo (registrada en otro teléfono).
export async function bajarFoto(imagenId) {
  if (!sb || !usuario || !libro) return null;
  const { data, error } = await sb.storage.from(BUCKET).download(`${libro.id}/${imagenId}.jpg`);
  if (error || !data) return null;
  return data;
}

export async function contarPendientesNube() {
  const n = await contarPendientes();
  avisar();
  return n;
}
