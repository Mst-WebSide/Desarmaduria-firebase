// Prueba de extremo a extremo de la migración de datos reales: corre
// migracion/migrar.js contra una COPIA del archivo SQLite real (nunca el
// original) y un Firestore falso, migrando solo el negocio 1 (real) y
// dejando afuera los dos negocios de demostración (2 y 3) — tal como el
// usuario pidió. Después levanta el server.js nuevo contra ese mismo
// Firestore falso y confirma, a través de la API real (no leyendo el
// Firestore falso directo), que los datos migrados se ven bien: se puede
// iniciar sesión con la contraseña real de un usuario migrado, los conteos
// de cada colección coinciden con lo que había en el SQLite original para
// el negocio 1, y nada de los negocios demo se coló.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { DatabaseSync } = require('node:sqlite');
const { FirestoreFalso, FieldValue } = require('./fake-firestore');
const { crearStorageFalso } = require('./fake-storage');
const { migrar } = require('../migracion/migrar');

const PUERTO = 3465;
process.env.PORT = String(PUERTO);
const BASE = `http://localhost:${PUERTO}`;

const ORIGEN_REAL = '/mnt/user-data/uploads/Proyectos/desarmaduria-erp-v7/db/desarmaduria.db';
const COPIA = '/tmp/desarmaduria-copia-para-prueba-migracion.db';

function cookieDe(res) {
  const set = res.headers.get('set-cookie');
  return set ? set.split(';')[0] : null;
}

function contarFilas(rutaDb, tabla, where) {
  const con = new DatabaseSync(rutaDb, { readOnly: true });
  try {
    const sql = where ? `SELECT COUNT(*) AS n FROM ${tabla} WHERE ${where}` : `SELECT COUNT(*) AS n FROM ${tabla}`;
    return con.prepare(sql).get().n;
  } finally {
    con.close();
  }
}

(async () => {
  assert.ok(fs.existsSync(ORIGEN_REAL), `No se encontró el SQLite real en ${ORIGEN_REAL} (¿hace falta volver a traerlo del computador del usuario?)`);
  fs.copyFileSync(ORIGEN_REAL, COPIA); // nunca se toca el original, solo se lee una copia

  const esperado = {
    usuarios: contarFilas(COPIA, 'usuarios', 'negocio_id = 1'),
    vehiculos: contarFilas(COPIA, 'vehiculos', 'negocio_id = 1'),
    inventario: contarFilas(COPIA, 'inventario', 'negocio_id = 1'),
    catalogo: contarFilas(COPIA, 'catalogo_repuestos', 'negocio_id = 1'),
    ventas: contarFilas(COPIA, 'ventas', 'negocio_id = 1'),
    auditoria: contarFilas(COPIA, 'auditoria', 'negocio_id = 1'),
  };

  const db = new FirestoreFalso();
  const storage = crearStorageFalso({ carpeta: '/tmp/desarmaduria-storage-falso-migracion', urlBase: 'http://localhost:9999/fake-storage' });

  const resumen = await migrar({ rutaSqlite: COPIA, db, storage, negociosAMigrar: [1], log: () => {} });
  console.log('Resumen de la migración:', resumen);

  assert.strictEqual(resumen.negocios, 1);
  assert.strictEqual(resumen.usuarios, esperado.usuarios);
  assert.strictEqual(resumen.vehiculos, esperado.vehiculos);
  assert.strictEqual(resumen.inventario, esperado.inventario);
  assert.strictEqual(resumen.catalogo_repuestos, esperado.catalogo);
  assert.strictEqual(resumen.ventas, esperado.ventas);
  assert.strictEqual(resumen.auditoria, esperado.auditoria);
  assert.strictEqual(resumen.chats, 0); // el negocio 2 (el otro lado del único chat) no se migró

  // Correrla una segunda vez sin forzar debe fallar (resguardo anti-duplicado)
  await assert.rejects(() => migrar({ rutaSqlite: COPIA, db, storage, negociosAMigrar: [1] }));

  // Los negocios demo NO deben existir en el destino
  const negocioDemo2 = await db.collection('negocios').doc('2').get();
  assert.strictEqual(negocioDemo2.exists, false);
  const negocioDemo3 = await db.collection('negocios').doc('3').get();
  assert.strictEqual(negocioDemo3.exists, false);

  // ---- Ahora, a través de la API real (no leyendo el Firestore falso directo) ----
  const server = require('../server');
  await server.iniciar(db, storage, FieldValue);

  // Login con la contraseña REAL de un usuario migrado (mbulon / desarme2026)
  let r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usuario: 'mbulon', password: 'desarme2026' }) });
  assert.strictEqual(r.status, 200);
  const cookie = cookieDe(r);
  const yo = await (await fetch(`${BASE}/api/auth/me`, { headers: { Cookie: cookie } })).json();
  assert.strictEqual(yo.negocio.nombre, 'Desarmaduría Quillota');

  r = await fetch(`${BASE}/api/inventario`, { headers: { Cookie: cookie } });
  assert.strictEqual((await r.json()).length, esperado.inventario);

  r = await fetch(`${BASE}/api/vehiculos`, { headers: { Cookie: cookie } });
  assert.strictEqual((await r.json()).length, esperado.vehiculos);

  r = await fetch(`${BASE}/api/ventas`, { headers: { Cookie: cookie } });
  const ventasMigradas = await r.json();
  assert.strictEqual(ventasMigradas.length, esperado.ventas);
  assert.ok(ventasMigradas.every((v) => v.estado === 'anulada')); // en los datos reales, las 2 de este negocio están anuladas

  r = await fetch(`${BASE}/api/auditoria`, { headers: { Cookie: cookie } });
  assert.strictEqual((await r.json()).length, Math.min(esperado.auditoria, 1000));

  // El marketplace no debe ver ningún negocio (los dos únicos candidatos eran demo)
  r = await fetch(`${BASE}/api/marketplace/negocios`, { headers: { Cookie: cookie } });
  assert.strictEqual((await r.json()).length, 0);

  console.log('✅ Todas las pruebas de migración de datos reales pasaron.');
  server.server.close();
  fs.unlinkSync(COPIA);
  process.exit(0);
})().catch((e) => {
  console.error('❌ Falló la prueba:', e);
  process.exit(1);
});
