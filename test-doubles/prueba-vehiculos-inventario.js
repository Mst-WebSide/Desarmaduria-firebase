// Prueba de extremo a extremo de vehículos + catálogo + inventario,
// incluyendo fotos (subida real a un "Cloud Storage falso" en disco) y el
// bloqueo de borrado cuando un repuesto ya tiene ventas asociadas.
const assert = require('assert');
const fs = require('fs');
const { FirestoreFalso, FieldValue } = require('./fake-firestore');
const { crearStorageFalso } = require('./fake-storage');
const auth = require('../auth');

const PUERTO = 3458;
process.env.PORT = String(PUERTO);
const BASE = `http://localhost:${PUERTO}`;

// Un JPEG mínimo válido en base64 (1x1 px), suficiente para probar la subida
// a storage sin depender de un archivo externo.
const JPEG_1x1_B64 =
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMDAwMDAwQEBAQFBQUFBgcGBgYHBwgICAgICAwMDAwMDAwODg4ODg4SEhISEhIVFRUVFRUYGBgYGBgcHBwcHBwgICAgICD/2wBDAQUFBQgGCAwICAwSDg4SHh4eHh4gICAgICAgHh4eHh4eICAgICAgICAgICAgICAgICAgICAgICAgICAgICD/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKRobHwFSNCUoKR0cLwMySD4gVVvC1k1yY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4eLj5OXm5+jp6vHy8/T19vf4+fr/2gAMAwEAAhEDEQA/AL+f/9k=';

function cookieDe(res) {
  const set = res.headers.get('set-cookie');
  return set ? set.split(';')[0] : null;
}

(async () => {
  const carpetaStorage = '/tmp/desarmaduria-storage-falso-inventario';
  fs.rmSync(carpetaStorage, { recursive: true, force: true });
  const db = new FirestoreFalso();
  const storage = crearStorageFalso({ carpeta: carpetaStorage, urlBase: 'http://localhost:9999/fake-storage' });

  await db.collection('negocios').doc('1').set({ nombre: 'Desarmaduría Quillota', activo: 1 });
  const { hash, salt } = auth.hashPassword('desarme2026');
  await db.collection('usuarios').doc('mbulon').set({ negocio_id: '1', nombre: 'Marta Bulón', password_hash: hash, salt, rol: 'admin', activo: 1, debe_cambiar_password: 0, creado_en: new Date().toISOString() });

  const server = require('../server');
  await server.iniciar(db, storage, FieldValue);

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

  // ---- Inventario (con fotos) ----
  const dataUrl = `data:image/jpeg;base64,${JPEG_1x1_B64}`;
  r = await fetch(`${BASE}/api/inventario`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ nombre: 'Alternador Hilux', categoria: 'Motor', vehiculo_id: v1.id, cantidad_disponible: 2, precio_venta: 65000, costo_unitario: 35000, foto_1: dataUrl }),
  });
  assert.strictEqual(r.status, 201);
  const item1 = await r.json();
  assert.ok(item1.foto_1 && item1.foto_1.startsWith('http'), 'foto_1 debe quedar como URL, no como data: URL');
  assert.strictEqual(fs.existsSync(`${carpetaStorage}/inventario__1__${item1.id}__foto_1.jpg`), true, 'el archivo debe haberse guardado físicamente en el storage falso');

  // Repuesto suelto, sin vehículo
  r = await fetch(`${BASE}/api/inventario`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ nombre: 'Batería genérica', categoria: 'Eléctrico', cantidad_disponible: 3, precio_venta: 55000 }) });
  const item2 = await r.json();
  assert.strictEqual(item2.vehiculo_id, null);

  // Listado: debe traer el nombre/patente del vehículo enlazado, y la lista NO debe traer foto_2/foto_3
  r = await fetch(`${BASE}/api/inventario`, { headers: { Cookie: cookie } });
  const lista = await r.json();
  const filaItem1 = lista.find((i) => i.id === item1.id);
  assert.strictEqual(filaItem1.vehiculo_patente, 'ABCD11');
  assert.strictEqual('foto_2' in filaItem1, false);

  // Filtro por categoría y por vehículo
  r = await fetch(`${BASE}/api/inventario?categoria=Eléctrico`, { headers: { Cookie: cookie } });
  assert.strictEqual((await r.json()).length, 1);
  r = await fetch(`${BASE}/api/inventario?vehiculo_id=${v1.id}`, { headers: { Cookie: cookie } });
  assert.strictEqual((await r.json()).length, 1);

  // Detalle sí trae las 3 fotos (aunque foto_2/foto_3 sean null)
  r = await fetch(`${BASE}/api/inventario/${item1.id}`, { headers: { Cookie: cookie } });
  const detalle = await r.json();
  assert.strictEqual('foto_2' in detalle, true);

  // Editar cantidad y quitar la foto 1
  r = await fetch(`${BASE}/api/inventario/${item1.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ cantidad_disponible: 1, foto_1: null }) });
  const editado = await r.json();
  assert.strictEqual(editado.cantidad_disponible, 1);
  assert.strictEqual(editado.foto_1, null);
  assert.strictEqual(fs.existsSync(`${carpetaStorage}/inventario__1__${item1.id}__foto_1.jpg`), false, 'el archivo debe haberse borrado del storage falso');

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
