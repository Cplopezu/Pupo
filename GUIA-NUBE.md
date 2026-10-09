# Guía: conectar Pupo a la nube

Con la nube activada, sus gastos y fotos quedan guardados en su cuenta: no se pierden si cambia o pierde el teléfono, se ven en el celular y en el computador, y puede compartir un libro de gastos con otra persona.

Se usa **Supabase**, un servicio con plan gratuito (500 MB de datos y 1 GB de fotos, suficiente para años de boletas). Toma unos 10 minutos y se hace una sola vez, idealmente desde el computador.

---

## 1. Crear la cuenta y el proyecto

1. Entre a **https://supabase.com** y pulse **Start your project**.
2. Elija **Continue with GitHub** (usa la misma cuenta de GitHub que ya tiene).
3. Pulse **New project** y complete:
   - **Name:** `pupo`
   - **Database Password:** pulse *Generate a password* y guárdela en un lugar seguro. No la necesitará en la app, pero es la llave maestra del proyecto.
   - **Region:** *South America (São Paulo)*.
4. Pulse **Create new project** y espere 1 o 2 minutos a que termine de prepararse.

## 2. Crear las tablas

1. En el menú de la izquierda, entre a **SQL Editor**.
2. Abra este archivo, seleccione todo el texto y cópielo:
   **https://github.com/Cplopezu/Pupo/blob/claude/expense-tracker-receipt-photo-8igp8q/supabase/schema.sql**
   (botón *Copy raw file*, arriba a la derecha del código).
3. Péguelo en el editor de Supabase y pulse **Run**.
4. Debe aparecer **Success. No rows returned**. Si aparece un aviso sobre "operaciones destructivas", confirme: el script no borra datos.

## 3. Indicar la dirección de la app

Así, el correo de confirmación de cuenta lo lleva de vuelta a Pupo.

1. Menú izquierdo: **Authentication** → **URL Configuration**.
2. En **Site URL** escriba: `https://cplopezu.github.io/Pupo/` y pulse **Save**.

## 4. Copiar los datos de conexión

1. Menú izquierdo: **Project Settings** (el engranaje) → **API** (en algunos paneles se llama **Data API** o **API Keys**).
2. Copie dos datos:
   - **Project URL**: se ve como `https://abcdxyz.supabase.co`
   - **anon public** (clave pública): un texto largo que empieza con `eyJ…`, o con `sb_publishable_…`

> **La clave pública se puede compartir**: la seguridad la dan las reglas del paso 2, que solo dejan ver a cada persona sus propios libros.
> **Nunca comparta** la clave `service_role` / `secret` ni la contraseña de la base de datos.

## 5. Conectar la app

1. Abra Pupo desde el ícono de su pantalla de inicio → **Ajustes** → **Cuenta y nube**.
2. Pegue la **URL** y la **clave pública** y pulse **Conectar**.
3. Escriba su correo y una contraseña (mínimo 6 caracteres) y pulse **Crear cuenta**.
4. Abra el correo de confirmación que le llega y pulse el enlace.
5. Vuelva a Pupo, escriba el mismo correo y contraseña y pulse **Entrar**.

Arriba aparecerá **☁ Sincronizado**. Los gastos que ya tenía en el teléfono se suben solos. Los datos de demostración nunca se suben.

> Para no tener que pegar la URL y la clave en cada equipo, envíeselas a Claude (solo esos dos datos) y quedarán incluidas en la app.

---

## Compartir un libro con otra persona

1. En **Ajustes → Cuenta y nube** verá su **código de invitación** (8 letras). Envíeselo.
2. La otra persona instala la app (`https://cplopezu.github.io/Pupo/` → *Agregar a pantalla de inicio*), la conecta (paso 5) y crea su propia cuenta.
3. En **Unirse a un libro** escribe el código y pulsa **Unirse**.

Desde ese momento ambos ven y registran en el mismo libro. Cada gasto y cada cambio quedan firmados con el correo de quien lo hizo (se ve en la ficha y en la bitácora). Nadie puede borrar gastos: solo anularlos con un motivo.

## Cómo funciona la sincronización

- La app **guarda primero en el teléfono** y sube los cambios a los pocos segundos. Sin señal, sigue funcionando y sube todo cuando vuelve la conexión.
- El indicador de arriba muestra el estado: **☁ Sincronizado**, **☁ N por subir**, **↻ Sincronizando…** o **⚠ Sin sincronizar** (tóquelo para ver el detalle).
- Si dos personas editan el mismo gasto, queda la versión más reciente, con ambos cambios anotados en la bitácora de quien editó último.

## Si algo no funciona

| Mensaje | Qué hacer |
|---|---|
| *Falta confirmar el correo* | Abra el correo de Supabase (revise Spam) y pulse el enlace. |
| *Correo o contraseña incorrectos* | Revise los datos o cree la cuenta si es la primera vez. |
| *Sin conexión con la nube* | Revise internet. Si persiste, entre a supabase.com: los proyectos gratuitos **se pausan tras 7 días sin uso**. Pulse *Restore project* y vuelva a sincronizar; nada se pierde. |
| *Ese código no corresponde a ningún libro* | Copie el código exactamente (8 letras y números). |
