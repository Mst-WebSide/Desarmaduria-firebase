// Punto de entrada en producción (Render, plan gratis): acá se decide qué
// conexión real de Firestore/Storage recibe server.js — en las pruebas, en
// cambio, cada test-doubles/prueba-*.js le inyecta el Firestore y Storage
// falsos directamente. Este archivo nunca se usa en las pruebas.
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
require('dotenv').config({ quiet: true });
// firebase-admin 14.x usa la API modular (no el namespace admin.firestore()
// de versiones viejas) — ver https://firebase.google.com/docs/admin/migrate.
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');
const { crearStorageReal } = require('./firebase/storage-real');
const server = require('./server');

// El SDK no adivina el bucket de Storage por sí solo fuera de Cloud
// Functions — hay que pasarlo explícito (ver FIREBASE_STORAGE_BUCKET en
// .env.example / DEPLOY.md). Si no se define, se intenta el nombre por
// defecto de un proyecto Firebase nuevo.
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
const storageBucket = process.env.FIREBASE_STORAGE_BUCKET || (PROJECT_ID ? `${PROJECT_ID}.appspot.com` : undefined);
initializeApp({ storageBucket });

const db = getFirestore();
const bucket = getStorage().bucket();
const storage = crearStorageReal(bucket);

server.iniciar(db, storage, FieldValue).catch((e) => {
  console.error('No se pudo iniciar el servidor:', e);
  process.exit(1);
});
