-- ============================================================
-- Pupo · Terminal de Gastos — base de datos en Supabase
-- Pegar completo en Supabase → SQL Editor → Run. Se puede ejecutar más de una vez.
-- ============================================================

-- Libros de gastos (uno personal, o compartido entre varias personas)
create table if not exists public.libros (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null default 'Mis gastos',
  codigo      text not null unique default upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8)),
  ajustes     jsonb not null default '{}'::jsonb,
  creado      timestamptz not null default now(),
  creado_por  uuid references auth.users on delete set null default auth.uid()
);

-- Quién pertenece a cada libro
create table if not exists public.miembros (
  libro_id  uuid not null references public.libros on delete cascade,
  user_id   uuid not null references auth.users on delete cascade default auth.uid(),
  email     text,
  rol       text not null default 'miembro',
  unido     timestamptz not null default now(),
  primary key (libro_id, user_id)
);

-- Gastos: el registro completo (con bitácora) va en "datos"
create table if not exists public.gastos (
  id              text primary key,
  libro_id        uuid not null references public.libros on delete cascade,
  datos           jsonb not null,
  modificado      bigint not null,
  actualizado     timestamptz not null default now(),
  actualizado_por uuid default auth.uid()
);
create index if not exists gastos_libro_actualizado on public.gastos (libro_id, actualizado);

-- Sello de servidor: cuándo y quién subió cada cambio (no lo puede falsear el teléfono)
create or replace function public.tocar_gasto() returns trigger
language plpgsql as $$
begin
  new.actualizado := now();
  new.actualizado_por := auth.uid();
  return new;
end $$;
drop trigger if exists gastos_tocar on public.gastos;
create trigger gastos_tocar before insert or update on public.gastos
  for each row execute function public.tocar_gasto();

-- ¿El usuario conectado pertenece al libro?
create or replace function public.es_miembro(l uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.miembros where libro_id = l and user_id = auth.uid());
$$;

-- Crear un libro propio
create or replace function public.crear_libro(p_nombre text default 'Mis gastos') returns public.libros
language plpgsql security definer set search_path = public as $$
declare l public.libros;
begin
  if auth.uid() is null then raise exception 'Debe iniciar sesión'; end if;
  insert into public.libros (nombre, creado_por) values (coalesce(nullif(p_nombre, ''), 'Mis gastos'), auth.uid()) returning * into l;
  insert into public.miembros (libro_id, user_id, email, rol) values (l.id, auth.uid(), auth.jwt() ->> 'email', 'dueño');
  return l;
end $$;

-- Unirse a un libro compartido con su código de invitación
create or replace function public.unirse_libro(p_codigo text) returns public.libros
language plpgsql security definer set search_path = public as $$
declare l public.libros;
begin
  if auth.uid() is null then raise exception 'Debe iniciar sesión'; end if;
  select * into l from public.libros where codigo = upper(trim(p_codigo));
  if l.id is null then raise exception 'Código no válido'; end if;
  insert into public.miembros (libro_id, user_id, email) values (l.id, auth.uid(), auth.jwt() ->> 'email')
    on conflict (libro_id, user_id) do nothing;
  return l;
end $$;

-- ---------- Seguridad por filas: cada persona solo ve sus libros ----------
alter table public.libros   enable row level security;
alter table public.miembros enable row level security;
alter table public.gastos   enable row level security;

drop policy if exists libros_ver on public.libros;
create policy libros_ver on public.libros for select using (public.es_miembro(id));
drop policy if exists libros_editar on public.libros;
create policy libros_editar on public.libros for update using (public.es_miembro(id)) with check (public.es_miembro(id));

drop policy if exists miembros_ver on public.miembros;
create policy miembros_ver on public.miembros for select using (public.es_miembro(libro_id));

drop policy if exists gastos_ver on public.gastos;
create policy gastos_ver on public.gastos for select using (public.es_miembro(libro_id));
drop policy if exists gastos_crear on public.gastos;
create policy gastos_crear on public.gastos for insert with check (public.es_miembro(libro_id));
drop policy if exists gastos_editar on public.gastos;
create policy gastos_editar on public.gastos for update using (public.es_miembro(libro_id)) with check (public.es_miembro(libro_id));
-- Sin política de borrado: los gastos no se eliminan, se anulan (trazabilidad).

-- ---------- Fotos de boletas (privadas, carpeta por libro) ----------
insert into storage.buckets (id, name, public) values ('boletas', 'boletas', false)
  on conflict (id) do nothing;

drop policy if exists boletas_ver on storage.objects;
create policy boletas_ver on storage.objects for select
  using (bucket_id = 'boletas' and public.es_miembro(((storage.foldername(name))[1])::uuid));
drop policy if exists boletas_subir on storage.objects;
create policy boletas_subir on storage.objects for insert
  with check (bucket_id = 'boletas' and public.es_miembro(((storage.foldername(name))[1])::uuid));
drop policy if exists boletas_actualizar on storage.objects;
create policy boletas_actualizar on storage.objects for update
  using (bucket_id = 'boletas' and public.es_miembro(((storage.foldername(name))[1])::uuid));
