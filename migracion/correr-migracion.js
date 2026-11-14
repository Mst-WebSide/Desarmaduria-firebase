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
const { migrar } = require('./migrar');

async function main() {
  const rutaSqlite = process.argv[2];
  if (!rutaSqlite) {
    console.error('Uso: node migracion/correr-migracion.js <ruta al desarmaduria.db> [--forzar]');
    process.exit(1);
  }
  const forzar = process.argv.includes('--forzar');

  initializeApp();
  const db = getFirestore();

  console.log(`Migrando "${rutaSqlite}" al proyecto Firebase actual (${getApp().options.projectId || 'sin projectId explícito'})...`);
  const resumen = await migrar({ rutaSqlite, db, forzar, log: (m) => console.log('→', m) });
  console.log('\n✅ Migración terminada. Resumen:', resumen);
  process.exit(0);
}

main().catch((e) => {
  console.error('❌ Falló la migración:', e.message);
  process.exit(1);
});
