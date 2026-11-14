// Prueba de extremo a extremo del taller mecánico: crear orden, editar,
// entregar (con cobro final distinto al presupuesto), bloqueo de PDF antes
// de entregar, y generación real del PDF (confirmando el header %PDF-).
const assert = require('assert');
const { FirestoreFalso, FieldValue } = require('./fake-firestore');
const auth = require('../auth');

const PUERTO = 3461;
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

  // Crear orden
  let r = await fetch(`${BASE}/api/taller/ordenes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ dueno_nombre: 'Carlos Soto', dueno_telefono: '+56999998888', vehiculo_patente: 'full99', comentario_ingreso: 'Ruido en suspensión', presupuesto_monto: 150000, presupuesto_notas: 'No incluye repuestos' }),
  });
  assert.strictEqual(r.status, 201);
  const orden = await r.json();
  assert.strictEqual(orden.numero, 1);
  assert.strictEqual(orden.vehiculo_patente, 'FULL99');
  assert.strictEqual(orden.estado, 'en_taller');
  assert.strictEqual('fotos_ingreso' in orden, false, 'esta versión no debe traer fotos');

  // Falta patente -> error
  r = await fetch(`${BASE}/api/taller/ordenes`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ dueno_nombre: 'Sin patente' }) });
  assert.strictEqual(r.status, 400);

  // No se puede pedir el PDF antes de entregar
  r = await fetch(`${BASE}/api/taller/ordenes/${orden.id}/pdf`, { headers: { Cookie: cookie } });
  assert.strictEqual(r.status, 400);

  // Editar la orden (corregir teléfono)
  r = await fetch(`${BASE}/api/taller/ordenes/${orden.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ dueno_telefono: '+56911112222' }) });
  assert.strictEqual((await r.json()).dueno_telefono, '+56911112222');

  // Entregar con un cobro final DISTINTO del presupuesto
  r = await fetch(`${BASE}/api/taller/ordenes/${orden.id}/entregar`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ trabajos_realizados: 'Se cambiaron amortiguadores delanteros.', cobro_final: 180000 }) });
  assert.strictEqual(r.status, 200);
  const entregada = await r.json();
  assert.strictEqual(entregada.estado, 'entregado');
  assert.strictEqual(entregada.cobro_final, 180000);
  assert.notStrictEqual(entregada.cobro_final, entregada.presupuesto_monto, 'el cobro final debe poder diferir del presupuesto');

  // No se puede entregar dos veces
  r = await fetch(`${BASE}/api/taller/ordenes/${orden.id}/entregar`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({}) });
  assert.strictEqual(r.status, 400);

  // Ahora sí se puede generar el PDF
  r = await fetch(`${BASE}/api/taller/ordenes/${orden.id}/pdf`, { headers: { Cookie: cookie } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.headers.get('content-type'), 'application/pdf');
  const buf = Buffer.from(await r.arrayBuffer());
  assert.strictEqual(buf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(buf.length > 500, 'el PDF no debería estar vacío');

  // Orden sin presupuesto_monto explícito en /entregar -> usa el presupuesto original
  r = await fetch(`${BASE}/api/taller/ordenes`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ dueno_nombre: 'Otra Persona', vehiculo_patente: 'xx11xx', presupuesto_monto: 50000 }) });
  const orden2 = await r.json();
  r = await fetch(`${BASE}/api/taller/ordenes/${orden2.id}/entregar`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({}) });
  assert.strictEqual((await r.json()).cobro_final, 50000);

  // Listas filtradas por estado
  r = await fetch(`${BASE}/api/taller/ordenes?estado=entregado`, { headers: { Cookie: cookie } });
  assert.strictEqual((await r.json()).length, 2);
  r = await fetch(`${BASE}/api/taller/ordenes?estado=en_taller`, { headers: { Cookie: cookie } });
  assert.strictEqual((await r.json()).length, 0);

  console.log('✅ Todas las pruebas de taller mecánico (sin fotos) pasaron.');
  server.server.close();
  process.exit(0);
})().catch((e) => {
  console.error('❌ Falló la prueba:', e);
  process.exit(1);
});
