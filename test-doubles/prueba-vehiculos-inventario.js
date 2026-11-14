// Prueba de extremo a extremo de vehículos + catálogo + inventario (sin
// fotos, por decisión del usuario) y el bloqueo de borrado cuando un
// repuesto ya tiene ventas asociadas.
const assert = require('assert');
const { FirestoreFalso, FieldValue } = require('./fake-firestore');
const auth = require('../auth');

const PUERTO = 3458;
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
  await db.collection('usuarios').doc('mbulon').set({ negocio_id: '1', nombre: 'Marta Bulón', password_hash: hash, salt, rol: 'admin', activo: 1, debe_cambiar_password: 0, creado_en: new Date().toISOString() });

  const server = require('../server');
  await server.iniciar(db, FieldValue);

  let r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usuario: 'mbulon', password: 'desarme2026' }) });
  const cookie = cookieDe(r);

  // ---- Vehículos ----
  r = await fetch(`${BASE}/api/vehiculos`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ patente: 'abcd11', marca: 'Toyota', modelo: 'Hilux', anio: 2015, costo_compra: 2000000 }) });
  assert.strictEqual(r.status, 201);
  const v1 = await r.json();
  assert.strictEqual(v1.numero, 1);
  assert.strictEqual(v1.patente, 'ABCD11', 'la patente debe quedar en mayúsculas');

  // Segundo vehículo, numeración automática correlativa
  r = await fetch(`${BASE}/api/vehiculos`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ marca: 'Nissan', modelo: 'Navara' }) });
  const v2 = await r.json();
  assert.strictEqual(v2.numero, 2);
  assert.strictEqual(v2.patente, null);

  // Número manual ya usado -> error
  r = await fetch(`${BASE}/api/vehiculos`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ marca: 'Repetido', numero: 1 }) });
  assert.strictEqual(r.status, 400);

  // Editar estado a desarmado
  r = await fetch(`${BASE}/api/vehiculos/${v1.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ estado: 'desarmado' }) });
  assert.strictEqual((await r.json()).estado, 'desarmado');

  // ---- Catálogo de repuestos ----
  r = await fetch(`${BASE}/api/catalogo-repuestos`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ categoria: 'Motor', nombre: 'Correa de distribución' }) });
  assert.strictEqual(r.status, 201);
  r = await fetch(`${BASE}/api/catalogo-repuestos`, { headers: { Cookie: cookie } });
  let catalogo = await r.json();
  assert.ok(catalogo.extra.Motor.includes('Correa de distribución'));

  // Ocultar un repuesto "de fábrica" (es_default) y confirmar que aparece en "ocultos"
  r = await fetch(`${BASE}/api/catalogo-repuestos`, { method: 'DELETE', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ categoria: 'Motor', nombre: 'Alternador', es_default: true }) });
  assert.strictEqual(r.status, 200);
  catalogo = await (await fetch(`${BASE}/api/catalogo-repuestos`, { headers: { Cookie: cookie } })).json();
  assert.ok(catalogo.ocultos.Motor.includes('Alternador'));

  // ---- Inventario (sin fotos) ----
  r = await fetch(`${BASE}/api/inventario`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ nombre: 'Alternador Hilux', categoria: 'Motor', vehiculo_id: v1.id, cantidad_disponible: 2, precio_venta: 65000, costo_unitario: 35000 }),
  });
  assert.strictEqual(r.status, 201);
  const item1 = await r.json();
  assert.strictEqual(item1.nombre, 'Alternador Hilux');

  // Repuesto suelto, sin vehículo
  r = await fetch(`${BASE}/api/inventario`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ nombre: 'Batería genérica', categoria: 'Eléctrico', cantidad_disponible: 3, precio_venta: 55000 }) });
  const item2 = await r.json();
  assert.strictEqual(item2.vehiculo_id, null);

  // Listado: debe traer el nombre/patente del vehículo enlazado
  r = await fetch(`${BASE}/api/inventario`, { headers: { Cookie: cookie } });
  const lista = await r.json();
  const filaItem1 = lista.find((i) => i.id === item1.id);
  assert.strictEqual(filaItem1.vehiculo_patente, 'ABCD11');

  // Filtro por categoría y por vehículo
  r = await fetch(`${BASE}/api/inventario?categoria=Eléctrico`, { headers: { Cookie: cookie } });
  assert.strictEqual((await r.json()).length, 1);
  r = await fetch(`${BASE}/api/inventario?vehiculo_id=${v1.id}`, { headers: { Cookie: cookie } });
  assert.strictEqual((await r.json()).length, 1);

  // Detalle de un repuesto
  r = await fetch(`${BASE}/api/inventario/${item1.id}`, { headers: { Cookie: cookie } });
  const detalle = await r.json();
  assert.strictEqual(detalle.id, item1.id);

  // Editar cantidad
  r = await fetch(`${BASE}/api/inventario/${item1.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ cantidad_disponible: 1 }) });
  const editado = await r.json();
  assert.strictEqual(editado.cantidad_disponible, 1);

  // Simular que item2 ya tiene una venta -> no se puede eliminar
  await db.collection('negocios').doc('1').collection('ventas').add({ items: [{ inventario_id: item2.id, cantidad: 1 }] });
  r = await fetch(`${BASE}/api/inventario/${item2.id}`, { method: 'DELETE', headers: { Cookie: cookie } });
  assert.strictEqual(r.status, 400);

  // item1 no tiene ventas -> sí se puede eliminar
  r = await fetch(`${BASE}/api/inventario/${item1.id}`, { method: 'DELETE', headers: { Cookie: cookie } });
  assert.strictEqual(r.status, 200);
  r = await fetch(`${BASE}/api/inventario/${item1.id}`, { headers: { Cookie: cookie } });
  assert.strictEqual(r.status, 404);

  console.log('✅ Todas las pruebas de vehículos/catálogo/inventario pasaron.');
  server.server.close();
  process.exit(0);
})().catch((e) => {
  console.error('❌ Falló la prueba:', e);
  process.exit(1);
});
