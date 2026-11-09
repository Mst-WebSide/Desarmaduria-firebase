// Prueba de extremo a extremo de ventas: descuento de stock (vehículo y
// bodega), venta sin stock suficiente, venta con repuesto de texto libre,
// anulación con reposición de stock, y que el ticket muestre de dónde salió
// cada ítem (vehículo o compra de bodega).
const assert = require('assert');
const { FirestoreFalso, FieldValue } = require('./fake-firestore');
const { crearStorageFalso } = require('./fake-storage');
const auth = require('../auth');

const PUERTO = 3460;
process.env.PORT = String(PUERTO);
const BASE = `http://localhost:${PUERTO}`;

function cookieDe(res) {
  const set = res.headers.get('set-cookie');
  return set ? set.split(';')[0] : null;
}

(async () => {
  const db = new FirestoreFalso();
  const storage = crearStorageFalso({ carpeta: '/tmp/desarmaduria-storage-falso-ventas', urlBase: 'http://localhost:9999/fake-storage' });
  await db.collection('negocios').doc('1').set({ nombre: 'Desarmaduría Quillota', telefono_dueno: '+56911111111', activo: 1 });
  const { hash, salt } = auth.hashPassword('desarme2026');
  await db.collection('usuarios').doc('mbulon').set({ negocio_id: '1', nombre: 'Marta Bulón', password_hash: hash, salt, rol: 'admin', activo: 1, creado_en: new Date().toISOString() });

  const server = require('../server');
  await server.iniciar(db, storage, FieldValue);
  const cookie = cookieDe(await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usuario: 'mbulon', password: 'desarme2026' }) }));

  // Vehículo + repuesto ligado
  let r = await fetch(`${BASE}/api/vehiculos`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ patente: 'abcd11', marca: 'Toyota' }) });
  const vehiculo = await r.json();
  r = await fetch(`${BASE}/api/inventario`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ nombre: 'Alternador', categoria: 'Motor', vehiculo_id: vehiculo.id, cantidad_disponible: 5, precio_venta: 65000 }) });
  const repuesto = await r.json();

  // Compra bodega + pieza
  r = await fetch(`${BASE}/api/bodega/compras`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ nombre: 'Motor completo' }) });
  const compra = await r.json();
  r = await fetch(`${BASE}/api/bodega/inventario`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ nombre: 'Block de motor', compra_id: compra.id, cantidad_disponible: 2, precio_venta: 120000 }) });
  const pieza = await r.json();

  // Venta con 3 ítems: uno de vehículo, uno de bodega, uno de texto libre
  r = await fetch(`${BASE}/api/ventas`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      tipo_pago: 'efectivo',
      cliente_nombre: 'Juan Soto',
      items: [
        { inventario_id: repuesto.id, cantidad: 2 },
        { origen: 'bodega', inventario_bodega_id: pieza.id, cantidad: 1 },
        { nombre_repuesto: 'Correa genérica', categoria: 'Otro', cantidad: 1, precio_unitario: 8000 },
      ],
    }),
  });
  assert.strictEqual(r.status, 201);
  const venta = await r.json();
  assert.strictEqual(venta.total, 2 * 65000 + 120000 + 8000);
  assert.strictEqual(venta.notificacion_whatsapp_estado, 'no_configurado');

  // El stock debe haber bajado en ambos inventarios
  r = await fetch(`${BASE}/api/inventario/${repuesto.id}`, { headers: { Cookie: cookie } });
  assert.strictEqual((await r.json()).cantidad_disponible, 3);
  r = await fetch(`${BASE}/api/bodega/inventario/${pieza.id}`, { headers: { Cookie: cookie } });
  assert.strictEqual((await r.json()).cantidad_disponible, 1);

  // El detalle de la venta debe traer de dónde salió cada ítem
  r = await fetch(`${BASE}/api/ventas/${venta.id}`, { headers: { Cookie: cookie } });
  const detalleVenta = await r.json();
  assert.strictEqual(detalleVenta.vendedor_nombre, 'Marta Bulón');
  const itVehiculo = detalleVenta.items.find((i) => i.inventario_id === repuesto.id);
  assert.strictEqual(itVehiculo.vehiculo_patente, 'ABCD11');
  const itBodega = detalleVenta.items.find((i) => i.inventario_bodega_id === pieza.id);
  assert.strictEqual(itBodega.bodega_compra_nombre, 'Motor completo');

  // Vender más de lo disponible -> error, sin descontar nada
  r = await fetch(`${BASE}/api/ventas`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ tipo_pago: 'efectivo', items: [{ inventario_id: repuesto.id, cantidad: 999 }] }) });
  assert.strictEqual(r.status, 400);

  // Anular la venta -> repone stock
  r = await fetch(`${BASE}/api/ventas/${venta.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ estado: 'anulada' }) });
  assert.strictEqual(r.status, 200);
  r = await fetch(`${BASE}/api/inventario/${repuesto.id}`, { headers: { Cookie: cookie } });
  assert.strictEqual((await r.json()).cantidad_disponible, 5);
  r = await fetch(`${BASE}/api/bodega/inventario/${pieza.id}`, { headers: { Cookie: cookie } });
  assert.strictEqual((await r.json()).cantidad_disponible, 2);

  // No se puede anular dos veces
  r = await fetch(`${BASE}/api/ventas/${venta.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ estado: 'anulada' }) });
  assert.strictEqual(r.status, 400);

  console.log('✅ Todas las pruebas de ventas pasaron.');
  server.server.close();
  process.exit(0);
})().catch((e) => {
  console.error('❌ Falló la prueba:', e);
  process.exit(1);
});
