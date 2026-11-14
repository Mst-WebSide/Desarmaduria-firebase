// Punto de entrada en producción (Render, plan gratis): acá se decide qué
// conexión real de Firestore recibe server.js — en las pruebas, en cambio,
// cada test-doubles/prueba-*.js le inyecta el Firestore falso directamente.
// Este archivo nunca se usa en las pruebas.
//
// Render no es infraestructura de Google, así que NO hay credenciales
// automáticas como en Cloud Run — siempre hace falta una clave de cuenta de
// servicio. El SDK de Firebase (`initializeApp()` sin el campo `credential`)
// busca sola la variable de entorno estándar GOOGLE_APPLICATION_CREDENTIALS,
// que debe apuntar a la ruta de un archivo JSON con esa clave. En Render,
// ese archivo se sube como "Secret File" (ver DEPLOY.md) y queda disponible
// en /etc/secrets/<nombre-del-archivo> — ahí es donde debe apuntar la
// variable. Localmente (por ejemplo para correr la migración a mano) es la
// misma variable, apuntando a una clave descargada desde la consola de
// Firebase.
//
// Por decisión del usuario, el sistema no maneja fotos de ningún tipo (ni
// en inventario ni en taller), así que no hace falta Cloud Storage de
// Firebase ni ningún servicio externo de imágenes.
require('dotenv').config({ quiet: true });
// firebase-admin 14.x usa la API modular (no el namespace admin.firestore()
// de versiones viejas) — ver https://firebase.google.com/docs/admin/migrate.
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const server = require('./server');

initializeApp();

const db = getFirestore();

server.iniciar(db, FieldValue).catch((e) => {
  console.error('No se pudo iniciar el servidor:', e);
  process.exit(1);
});
