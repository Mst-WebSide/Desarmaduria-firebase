# Guía de despliegue — ERP Desarmaduría en Firebase + Render

Esta guía asume lo ya decidido: Firestore como base de datos (plan **Spark**,
el gratuito — sin tarjeta de crédito), **Render** para el backend (este mismo
`server.js`, sin cambios de framework, plan gratis de Render — tampoco pide
tarjeta para uso normal) y el propio Render como la puerta de entrada
pública (no se usa Firebase Hosting: no tiene sentido sin Cloud Run, que sí
exige el plan Blaze de pago). El sistema no maneja fotos de ningún tipo (ni
en inventario ni en taller — por decisión del usuario, para no depender de
Cloud Storage de Firebase, que desde fines de 2024 exige Blaze solo para
poder crearse, ni de ningún servicio externo de imágenes). Todo el trabajo
de código ya está hecho y probado contra un Firestore falso (ver
`test-doubles/`) — lo que queda es exclusivamente infraestructura y pasos
que solo el dueño de la cuenta puede hacer.

## 0. Qué es de quién

Yo (el asistente) puedo escribir y probar todo el código, pero **no puedo**:
crear el proyecto Firebase, crear tu cuenta de Render, ni iniciar sesión con
tus cuentas. Esos pasos son tuyos. Ninguno de los dos pide tarjeta de
crédito para lo que necesita esta desarmaduría (Render solo la pediría si
alguna vez te excedes de las 750 horas gratis al mes o del ancho de banda
incluido — muy improbable con un solo negocio). Todo lo demás (comandos de
deploy, configuración) te lo puedo ir guiando o hacer contigo en una sesión
donde tengas tu terminal a mano.

## 1. Crear el proyecto Firebase (tú)

1. Ir a <https://console.firebase.google.com> → "Agregar proyecto".
2. Elegir un nombre. Anota el **ID del proyecto** que Firebase asigna (puede
   diferir del nombre) — se usa en varios pasos siguientes. (Ya hecho:
   `desarmaduria-quillota`.)
3. **No hace falta pasar a Blaze.** El plan **Spark** (gratuito, sin
   tarjeta) alcanza de sobra para Firestore con el uso de una sola
   desarmaduría (cupos gratis: 50.000 lecturas y 20.000 escrituras al día,
   1 GB de base de datos — revisa los cupos actualizados en la consola,
   pueden cambiar).
4. En el menú lateral: **Firestore Database** → Crear base de datos → modo
   **Nativo** (no "Datastore") → elegir una región (ej. `us-central1` o la
   más cercana a Chile que ofrezcan). **Esta elección es definitiva, no se
   puede cambiar después sin crear un proyecto nuevo.**
5. **No hace falta entrar a "Storage"** en el menú lateral — el sistema no
   lo usa (ver nota arriba sobre fotos).

## 2. Instalar el CLI de Firebase (tú, en tu computador)

```bash
npm install -g firebase-tools
firebase login
```

Ya no hace falta el CLI de Google Cloud (`gcloud`) — eso era solo para
desplegar a Cloud Run, que ya no usamos.

## 3. Subir este proyecto a un repositorio Git

Render despliega leyendo un repositorio (GitHub, GitLab o Bitbucket) — no
hay forma de subirle un zip a mano. Si el proyecto todavía no está en un
repo propio:

```bash
cd desarmaduria-firebase-nuevo
git init
git add .
git commit -m "Versión Firebase + Render del ERP"
```

Después crea un repositorio **privado** en <https://github.com/new> (no
hace falta que sea público) y sigue las instrucciones que GitHub te muestra
para "...or push an existing repository from the command line" (algo como):

```bash
git remote add origin https://github.com/<tu-usuario>/<nombre-del-repo>.git
git branch -M main
git push -u origin main
```

Nota: hay un `.dockerignore` pero conviene además tener un `.gitignore` con
al menos `node_modules/` y `.env` para no subir esos dos al repo. Si no
existe, avísame y te lo agrego.

```bash
cd desarmaduria-firebase-nuevo
firebase use --add            # elige tu proyecto, ponle el alias "default"
```

## 4. Configurar variables de entorno (para probar localmente, opcional)

```bash
cp .env.example .env
```

`CLAVE_MAESTRA_DESBLOQUEO` es opcional (ver `auth.js`/`server.js`). Esto es
solo para correr el servidor en tu propio computador antes de desplegar; en
Render estas variables se configuran por separado (paso 6).

## 5. Crear la clave de cuenta de servicio (tú)

Render no es infraestructura de Google, así que (a diferencia de Cloud Run)
no recibe credenciales automáticas — el backend necesita una clave de
cuenta de servicio para poder leer/escribir en Firestore.

1. Firebase Console → ⚙️ Configuración del proyecto → **Cuentas de
   servicio** → "Generar nueva clave privada". Se descarga un archivo
   `.json` — guárdalo, lo vas a usar dos veces (Render y la migración de
   datos, paso 8). **Nunca lo subas al repositorio de git.**

## 6. Desplegar el backend en Render (tú, con mi ayuda paso a paso)

1. Ir a <https://render.com> → crear cuenta (no pide tarjeta).
2. **New +** → **Web Service** → conectar el repositorio del paso 3.
3. En la configuración del servicio:
   - **Environment**: `Docker` (Render detecta el `Dockerfile` del proyecto
     solo).
   - **Instance Type**: `Free`.
   - Región: la que esté más cerca (no tiene que ser la misma que
     Firestore).
4. Antes de crear el servicio, bajar a **Advanced** y agregar:
   - **Environment Variables**:
     - `GOOGLE_APPLICATION_CREDENTIALS` = `/etc/secrets/firebase-service-account.json`
     - `CLAVE_MAESTRA_DESBLOQUEO` = (opcional, la que quieras)
     - Las de WhatsApp si las vas a usar (ver `.env.example`).
   - **Secret Files** → "+ Add Secret File":
     - **Filename**: `firebase-service-account.json`
     - **Contents**: pegar el contenido completo del archivo `.json`
       descargado en el paso 5.
5. **Create Web Service**. Render va a construir la imagen con el
   `Dockerfile` y desplegarla — la primera build tarda unos minutos. Al
   terminar te da una URL pública fija como
   `https://desarmaduria-backend.onrender.com`.

**Cómo se comporta el plan gratis:** el servicio se "duerme" después de 15
minutos sin tráfico entrante, y tarda alrededor de un minuto en "despertar"
cuando llega la primera visita después de eso (se nota como una carga lenta
la primera vez). Incluye 750 horas gratis al mes por workspace, que alcanza
para tener el servicio despierto todo un mes si hace falta. No se cobra nada
mientras te mantengas dentro de esos cupos.

Cada vez que hagas `git push` a la rama conectada (`main`), Render
redespliega solo.

## 7. Reglas e índices de Firestore

Desde tu computador (usando el CLI de Firebase, no Render):

```bash
cd desarmaduria-firebase-nuevo
firebase deploy --only firestore:rules,firestore:indexes
```

- `firestore.rules`: niega todo acceso directo desde el navegador — el
  frontend nunca habla con Firestore directo, solo con `/api/...` en el
  propio backend (Render) (ver los comentarios en ese archivo).
- `firestore.indexes.json`: ya incluye el índice que necesita
  `/api/marketplace/buscar` (una consulta `collectionGroup` sobre
  `inventario`). Si en el futuro se agrega alguna otra consulta
  `collectionGroup`, Firestore tirará un error en los logs (visibles en el
  Dashboard de Render, pestaña "Logs") con un link directo para crear el
  índice que falte — es la señal de que hay que agregar una entrada nueva a
  este archivo y volver a desplegar.

## 8. Migrar los datos reales (una sola vez)

Con el backend ya desplegado (o incluso antes, no es necesario que esté
desplegado, solo que Firestore exista), desde tu computador:

```bash
GOOGLE_APPLICATION_CREDENTIALS=/ruta/a/la/misma/clave-del-paso-5.json \
  node migracion/correr-migracion.js /ruta/a/desarmaduria.db
```

(Es la misma clave `.json` que subiste a Render como Secret File en el paso
6 — puedes reusarla, no hace falta generar una segunda. Si prefieres no
tenerla en tu computador después de este paso, puedes borrarla al terminar;
la copia que quedó en Render sigue funcionando igual.)

Por decisión ya tomada, esto migra **solo el negocio real** (no los dos
negocios de demostración) — ver `migracion/migrar.js` si en algún momento
se quiere cambiar eso (`NEGOCIOS_A_MIGRAR`). El script avisa y se detiene
si el negocio ya existe en el destino, para no duplicar nada si se corre
dos veces por error. Las fotos que el inventario pueda tener en el sistema
viejo no se migran — el sistema nuevo no las usa (igual que el taller).

Después de migrar, todos los usuarios pueden entrar con la MISMA
contraseña que tenían en el sistema actual — no hay que resetear nada.
Vale la pena avisarles que cambien su contraseña desde Administración
igualmente, ya que varias comparten la clave inicial `desarme2026`.

## 9. Verificar

- Entrar a `https://<tu-servicio>.onrender.com/login.html` y loguearse con
  un usuario real migrado. (La URL exacta la da Render al terminar el
  despliegue del paso 6; si más adelante conectas un dominio propio desde
  el Dashboard de Render, esa sería la URL final.)
- Si el sitio tarda ~1 minuto en cargar la primera vez, es el "despertar"
  normal del plan gratis después de 15 minutos sin visitas — no es un
  error.
- Revisar que el panel de ventas, inventario, vehículos y el mercado entre
  negocios muestren los datos esperados.
- Probar "Mercado entre negocios" en particular: si Firestore se queja de
  un índice faltante, seguir el link que aparece en los logs de Render
  (Dashboard → tu servicio → Logs) para crearlo, o agregarlo a
  `firestore.indexes.json` y volver a `firebase deploy --only
  firestore:indexes`.

## 10. Corte real (apagar el sistema viejo)

Cuando todo esté verificado:

1. Avisar a los usuarios el día/hora del corte.
2. Dejar de aceptar ventas nuevas en el sistema Windows viejo un momento
   antes de migrar, para que los datos migrados sean el estado final real
   (si se migra mientras el sistema viejo sigue recibiendo ventas, esas
   ventas nuevas no quedan en Firestore).
3. Volver a correr `migracion/correr-migracion.js` no sirve para
   "actualizar" — está pensado para una sola corrida. Si hace falta
   recapturar cambios de último minuto, lo más simple es cargarlos a mano
   una vez en el sistema nuevo (son pocos datos a esa altura).
4. Compartir la URL de Render (`https://<tu-servicio>.onrender.com`) con el
   equipo y dejar de usar el servidor Windows. Si el "despertar" de ~1
   minuto tras 15 minutos de inactividad molesta en el uso diario, se puede
   conectar un dominio propio desde Render (Dashboard → Settings → Custom
   Domain, gratis) sin que eso cambie el comportamiento de sueño — o, si en
   algún momento el negocio justifica el gasto, pasar ese único servicio al
   plan pago de Render (unos USD 7/mes) para que no se duerma nunca; nada
   de esto obliga a tocar Firebase.
