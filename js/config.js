// Conexión a la nube (Supabase). Si se dejan vacíos, la app funciona solo en el dispositivo
// y la conexión puede configurarse desde Ajustes → Cuenta y nube.
// La clave "anon" es pública por diseño: la seguridad la dan las reglas de supabase/schema.sql.
export const NUBE = {
  url: '',
  anonKey: '',
};
