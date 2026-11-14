// Prueba de extremo a extremo de repisas + compras de bodega + inventario
// bodega: ubicación (repisa+fila), límites de filas en uso, y bloqueo de
// borrado por ventas asociadas (usando inventario_bodega_id, no
// inventario_id — son dos campos distintos en venta_items).
const assert = require('assert');
const { FirestoreFalso, FieldValue } = require('./fake-firestore');
const auth = require('../auth');

const PUERTO = 3459;
process.env.PORT = String(PUERTO);
const BASE = `http://localhost:${PUERTO}`;

function cookieDe(res) {
  const set = res.headers.get('set-cookie');
  return set ? set.split(';')[0] : null;
}

(async () => {
  const db = new FirestoreFalso();
  await db.collection('negocios').doc('1').set({ nombre: 'Desarmaduría Quillota', activo: 1 });
  const { hash, salt } = auth.hashPassword('desarme2026');
  await db.collection('usuarios').doc('mbulon').set({ negocio_id: '1', nombre: 'Marta Bulón', password_hash: hash, salt, rol: 'admin', activo: 1, creado_en: new Date().toISOString() });

  const server = require('../server');
  await server.iniciar(db, FieldValue);
  const cookie = cookieDe(await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usuario: 'mbulon', password: 'desarme2026' }) }));

  // Repisa con 3 filas
  let r = await fetch(`${BASE}/api/repisas`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ nombre: 'Repisa 1', cantidad_filas: 3 }) });
  const repisa = await r.json();
  assert.strictEqual(repisa.cantidad_filas, 3);

  // Compra bodega (numeración correlativa)
  r = await fetch(`${BASE}/api/bodega/compras`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ nombre: 'Motor completo', proveedor: 'Juan Pérez', costo_total: 250000 }) });
  const compra = await r.json();
  assert.strictEqual(compra.numero, 1);

  // Pieza en fila 2 de la repisa, ligada a la compra
  r = await fetch(`${BASE}/api/bodega/inventario`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ nombre: 'Block de motor', categoria: 'Motor', compra_id: compra.id, repisa_id: repisa.id, fila: 2, precio_venta: 120000, costo_unitario: 70000 }) });
  assert.strictEqual(r.status, 201);
  const pieza1 = await r.json();

  // Fila fuera de rango -> error
  r = await fetch(`${BASE}/api/bodega/inventario`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ nombre: 'Culata', repisa_id: repisa.id, fila: 9 }) });
  assert.strictEqual(r.status, 400);

  // No se puede bajar la repisa a 1 fila porque ya hay algo en la fila 2
  r = await fetch(`${BASE}/api/repisas/${repisa.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ cantidad_filas: 1 }) });
  assert.strictEqual(r.status, 400);

  // El detalle de la compra trae la pieza, con el nombre de la repisa incluido
  r = await fetch(`${BASE}/api/bodega/compras/${compra.id}`, { headers: { Cookie: cookie } });
  const detalleCompra = await r.json();
  assert.strictEqual(detalleCompra.piezas.length, 1);
  assert.strictEqual(detalleCompra.piezas[0].repisa_nombre, 'Repisa 1');

  // No se puede borrar la repisa mientras tenga algo guardado
  r = await fetch(`${BASE}/api/repisas/${repisa.id}`, { method: 'DELETE', headers: { Cookie: cookie } });
  assert.strictEqual(r.status, 400);

  // Simular una venta de esta pieza (inventario_bodega_id, no inventario_id) -> no se puede borrar
  await db.collection('negocios').doc('1').collection('ventas').add({ items: [{ inventario_bodega_id: pieza1.id, cantidad: 1 }] });
  r = await fetch(`${BASE}/api/bodega/inventario/${pieza1.id}`, { method: 'DELETE', headers: { Cookie: cookie } });
  assert.strictEqual(r.status, 400);

  // Editar la pieza (cambiar cantidad) sí funciona aunque tenga ventas
  r = await fetch(`${BASE}/api/bodega/inventario/${pieza1.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ cantidad_disponible: 0, activo: false }) });
  assert.strictEqual(r.status, 200);
  assert.strictEqual((await r.json()).activo, 0);

  console.log('✅ Todas las pruebas de bodega (repisas/compras/inventario) pasaron.');
  server.server.close();
  process.exit(0);
})().catch((e) => {
  console.error('❌ Falló la prueba:', e);
  process.exit(1);
});
