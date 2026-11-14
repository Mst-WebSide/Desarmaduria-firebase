// Prueba de extremo a extremo de reportes/dashboard y auditoría: resumen,
// ventas por mes/categoría/tipo de pago, top repuestos, el detalle de ventas
// (trazabilidad, incluye ventas anuladas) y la bitácora de auditoría —
// ambas últimas con exportación CSV. También confirma que un rol que no es
// "admin" no pueda ver ninguna de estas vistas.
const assert = require('assert');
const { FirestoreFalso, FieldValue } = require('./fake-firestore');
const auth = require('../auth');

const PUERTO = 3463;
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
  await db.collection('usuarios').doc('vtest').set({ negocio_id: '1', nombre: 'Vicente Test', password_hash: hash, salt, rol: 'vendedor', activo: 1, creado_en: new Date().toISOString() });

  const server = require('../server');
  await server.iniciar(db, FieldValue);
  const cookieAdmin = cookieDe(await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usuario: 'mbulon', password: 'desarme2026' }) }));
  const cookieVendedor = cookieDe(await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usuario: 'vtest', password: 'desarme2026' }) }));

  // ---- Datos base ----
  let r = await fetch(`${BASE}/api/vehiculos`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookieAdmin }, body: JSON.stringify({ patente: 'xyz22', marca: 'Toyota', costo_compra: 500000 }) });
  const vehiculo = await r.json();

  r = await fetch(`${BASE}/api/inventario`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookieAdmin }, body: JSON.stringify({ nombre: 'Alternador', categoria: 'Motor', vehiculo_id: vehiculo.id, cantidad_disponible: 5, cantidad_minima: 1, precio_venta: 65000 }) });
  const alternador = await r.json();

  r = await fetch(`${BASE}/api/inventario`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookieAdmin }, body: JSON.stringify({ nombre: 'Filtro de aceite', categoria: 'Motor', cantidad_disponible: 0, cantidad_minima: 2, precio_venta: 10000 }) });
  await r.json(); // bajo stock, no se usa en ventas

  r = await fetch(`${BASE}/api/bodega/compras`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookieAdmin }, body: JSON.stringify({ nombre: 'Motor completo' }) });
  const compra = await r.json();
  r = await fetch(`${BASE}/api/bodega/inventario`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookieAdmin }, body: JSON.stringify({ nombre: 'Block de motor', categoria: 'Transmisión', compra_id: compra.id, cantidad_disponible: 2, precio_venta: 120000 }) });
  const pieza = await r.json();

  // ---- Ventas ----
  r = await fetch(`${BASE}/api/ventas`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookieAdmin }, body: JSON.stringify({ tipo_pago: 'efectivo', items: [{ inventario_id: alternador.id, cantidad: 1 }] }) });
  const venta1 = await r.json();

  r = await fetch(`${BASE}/api/ventas`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookieVendedor }, body: JSON.stringify({ tipo_pago: 'tarjeta_debito', items: [{ origen: 'bodega', inventario_bodega_id: pieza.id, cantidad: 1 }] }) });
  const venta2 = await r.json();

  r = await fetch(`${BASE}/api/ventas`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookieAdmin }, body: JSON.stringify({ tipo_pago: 'efectivo', items: [{ nombre_repuesto: 'Correa', categoria: 'Otro', cantidad: 2, precio_unitario: 5000 }] }) });
  const venta3 = await r.json();

  r = await fetch(`${BASE}/api/ventas`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookieAdmin }, body: JSON.stringify({ tipo_pago: 'efectivo', items: [{ inventario_id: alternador.id, cantidad: 1 }] }) });
  const venta4 = await r.json();
  r = await fetch(`${BASE}/api/ventas/${venta4.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: cookieAdmin }, body: JSON.stringify({ estado: 'anulada' }) });
  assert.strictEqual(r.status, 200);

  // ---- /api/reportes/resumen ----
  r = await fetch(`${BASE}/api/reportes/resumen`, { headers: { Cookie: cookieAdmin } });
  assert.strictEqual(r.status, 200);
  const resumen = await r.json();
  assert.strictEqual(resumen.totalVentas, 3); // venta4 anulada no cuenta
  assert.strictEqual(resumen.montoTotal, 65000 + 120000 + 10000);
  assert.strictEqual(resumen.ventasHoy, 3);
  assert.strictEqual(resumen.bajoStock, 1); // solo "Filtro de aceite"
  assert.strictEqual(resumen.totalRepuestos, 2);
  assert.strictEqual(resumen.costoTotalVehiculos, 500000);
  assert.strictEqual(resumen.gananciaTotalVehiculos, 4 * 65000 + 0 * 10000); // alternador quedó en 4 (venta4 repuso el suyo)

  // Un rol que no es admin no puede ver reportes ni auditoría
  r = await fetch(`${BASE}/api/reportes/resumen`, { headers: { Cookie: cookieVendedor } });
  assert.strictEqual(r.status, 403);
  r = await fetch(`${BASE}/api/auditoria`, { headers: { Cookie: cookieVendedor } });
  assert.strictEqual(r.status, 403);

  // ---- /api/reportes/ventas-por-mes ----
  r = await fetch(`${BASE}/api/reportes/ventas-por-mes`, { headers: { Cookie: cookieAdmin } });
  const porMes = await r.json();
  assert.strictEqual(porMes.length, 1);
  assert.strictEqual(porMes[0].cantidad, 3);
  assert.strictEqual(porMes[0].total, 195000);

  // ---- /api/reportes/ventas-por-categoria ----
  r = await fetch(`${BASE}/api/reportes/ventas-por-categoria`, { headers: { Cookie: cookieAdmin } });
  const porCategoria = await r.json();
  assert.strictEqual(porCategoria.length, 3);
  const motor = porCategoria.find((c) => c.categoria === 'Motor');
  assert.strictEqual(motor.monto_total, 65000);
  const transmision = porCategoria.find((c) => c.categoria === 'Transmisión');
  assert.strictEqual(transmision.monto_total, 120000);
  const otro = porCategoria.find((c) => c.categoria === 'Otro');
  assert.strictEqual(otro.cantidad, 2);

  // ---- /api/reportes/ventas-por-tipo-pago ----
  r = await fetch(`${BASE}/api/reportes/ventas-por-tipo-pago`, { headers: { Cookie: cookieAdmin } });
  const porTipoPago = await r.json();
  const efectivo = porTipoPago.find((t) => t.tipo_pago === 'efectivo');
  assert.strictEqual(efectivo.cantidad, 2);
  assert.strictEqual(efectivo.monto_total, 75000);
  const debito = porTipoPago.find((t) => t.tipo_pago === 'tarjeta_debito');
  assert.strictEqual(debito.monto_total, 120000);

  // ---- /api/reportes/top-repuestos ----
  r = await fetch(`${BASE}/api/reportes/top-repuestos`, { headers: { Cookie: cookieAdmin } });
  const topRepuestos = await r.json();
  const correa = topRepuestos.find((t) => t.nombre_repuesto === 'Correa');
  assert.strictEqual(correa.cantidad, 2);
  assert.strictEqual(topRepuestos.length, 3);

  // ---- /api/reportes/ventas-detalle ----
  r = await fetch(`${BASE}/api/reportes/ventas-detalle`, { headers: { Cookie: cookieAdmin } });
  const detalle = await r.json();
  assert.strictEqual(detalle.length, 4); // incluye el ítem de la venta anulada
  const filaAnulada = detalle.find((f) => f.venta_id === venta4.id);
  assert.strictEqual(filaAnulada.estado, 'anulada');
  const filaVehiculo = detalle.find((f) => f.venta_id === venta1.id);
  assert.strictEqual(filaVehiculo.vehiculo_patente, 'XYZ22');
  const filaBodega = detalle.find((f) => f.venta_id === venta2.id);
  assert.strictEqual(filaBodega.bodega_compra_nombre, 'Motor completo');
  assert.strictEqual(filaBodega.vendedor_nombre, 'Vicente Test');

  // Filtro por usuario_id (= username del vendedor)
  r = await fetch(`${BASE}/api/reportes/ventas-detalle?usuario_id=vtest`, { headers: { Cookie: cookieAdmin } });
  const detallePorUsuario = await r.json();
  assert.strictEqual(detallePorUsuario.length, 1);
  assert.strictEqual(detallePorUsuario[0].venta_id, venta2.id);

  // Filtro por categoría y por texto libre
  r = await fetch(`${BASE}/api/reportes/ventas-detalle?categoria=Otro`, { headers: { Cookie: cookieAdmin } });
  assert.strictEqual((await r.json()).length, 1);
  r = await fetch(`${BASE}/api/reportes/ventas-detalle?q=correa`, { headers: { Cookie: cookieAdmin } });
  assert.strictEqual((await r.json()).length, 1);

  // Exportación CSV
  r = await fetch(`${BASE}/api/reportes/ventas-detalle?formato=csv`, { headers: { Cookie: cookieAdmin } });
  assert.strictEqual(r.status, 200);
  assert.ok((r.headers.get('content-type') || '').includes('text/csv'));
  const csvVentas = await r.text();
  assert.ok(csvVentas.includes('Correa'));
  assert.ok(csvVentas.includes('Venta #'));

  // ---- /api/auditoria ----
  r = await fetch(`${BASE}/api/auditoria`, { headers: { Cookie: cookieAdmin } });
  const auditoria = await r.json();
  assert.ok(auditoria.length >= 9); // vehiculo, 2x inventario, compra, pieza, 4 ventas + 1 anulación
  const anulaciones = auditoria.filter((a) => a.accion === 'venta_anulada');
  assert.strictEqual(anulaciones.length, 1);

  r = await fetch(`${BASE}/api/auditoria?accion=venta_anulada`, { headers: { Cookie: cookieAdmin } });
  assert.strictEqual((await r.json()).length, 1);

  r = await fetch(`${BASE}/api/auditoria?usuario_id=vtest`, { headers: { Cookie: cookieAdmin } });
  const auditoriaVtest = await r.json();
  assert.ok(auditoriaVtest.length >= 1);
  assert.ok(auditoriaVtest.every((a) => a.usuario_nombre === 'Vicente Test'));

  r = await fetch(`${BASE}/api/auditoria?formato=csv`, { headers: { Cookie: cookieAdmin } });
  assert.strictEqual(r.status, 200);
  assert.ok((r.headers.get('content-type') || '').includes('text/csv'));
  const csvAuditoria = await r.text();
  assert.ok(csvAuditoria.includes('Venta anulada'));

  console.log('✅ Todas las pruebas de reportes/auditoría pasaron.');
  server.server.close();
  process.exit(0);
})().catch((e) => {
  console.error('❌ Falló la prueba:', e);
  process.exit(1);
});
