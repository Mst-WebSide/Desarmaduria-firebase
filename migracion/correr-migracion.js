// CLI para correr la migración real (una sola vez) contra el proyecto
// Firebase de verdad. Nunca se usa en las pruebas (ver
// test-doubles/prueba-migracion.js, que usa el Firestore falso) — esto es
// específicamente para el día del corte real.
//
// Uso:
//   GOOGLE_APPLICATION_CREDENTIALS=/ruta/a/clave-cuenta-servicio.json \
//     node migracion/correr-migracion.js /ruta/a/desarmaduria.db
//
// Agregar --forzar al final solo si de verdad se quiere volver a correr la
// migración sobre un negocio que ya existe en el destino (puede duplicar
// ventas/auditoría/mensajes — ver el resguardo en migrar.js).
require('dotenv').config({ quiet: true });
// Misma API modular de firebase-admin 14.x que usa index.js — ver el
// comentario ahí.
const { initializeApp, getApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');
const { crearStorageReal } = require('../firebase/storage-real');
const { migrar } = require('./migrar');

async function main() {
  const rutaSqlite = process.argv[2];
  if (!rutaSqlite) {
    console.error('Uso: node migracion/correr-migracion.js <ruta al desarmaduria.db> [--forzar]');
    process.exit(1);
  }
  const forzar = process.argv.includes('--forzar');

  // Mismo bucket explícito que index.js — ver ese comentario.
  const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
  const storageBucket = process.env.FIREBASE_STORAGE_BUCKET || (PROJECT_ID ? `${PROJECT_ID}.appspot.com` : undefined);
  initializeApp({ storageBucket });
  const db = getFirestore();
  const bucket = getStorage().bucket();
  const storage = crearStorageReal(bucket);

  console.log(`Migrando "${rutaSqlite}" al proyecto Firebase actual (${getApp().options.projectId || 'sin projectId explícito'})...`);
  const resumen = await migrar({ rutaSqlite, db, storage, forzar, log: (m) => console.log('→', m) });
  console.log('\n✅ Migración terminada. Resumen:', resumen);
  process.exit(0);
}

main().catch((e) => {
  console.error('❌ Falló la migración:', e.message);
  process.exit(1);
});
