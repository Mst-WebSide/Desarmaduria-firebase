// Prueba de extremo a extremo del marketplace (cruza negocios a propósito)
// y el chat entre negocios. Dos negocios distintos, cada uno con su propio
// admin, para confirmar que: (a) el marketplace nunca muestra el propio
// inventario, solo el ajeno; (b) el chat solo lo pueden ver los dos negocios
// involucrados.
const assert = require('assert');
const { FirestoreFalso, FieldValue } = require('./fake-firestore');
const auth = require('../auth');

const PUERTO = 3462;
process.env.PORT = String(PUERTO);
const BASE = `http://localhost:${PUERTO}`;

function cookieDe(res) {
  const set = res.headers.get('set-cookie');
  return set ? set.split(';')[0] : null;
}

(async () => {
  const db = new FirestoreFalso();

  await db.collection('negocios').doc('1').set({ nombre: 'Desarmaduría Quillota', activo: 1 });
  await db.collection('negocios').doc('2').set({ nombre: 'Repuestos Sur Desarme', activo: 1 });
  await db.collection('negocios').doc('3').set({ nombre: 'Negocio Inactivo', activo: 0 });
  const { hash, salt } = auth.hashPassword('desarme2026');
  await db.collection('usuarios').doc('mbulon').set({ negocio_id: '1', nombre: 'Marta Bulón', password_hash: hash, salt, rol: 'admin', activo: 1, creado_en: new Date().toISOString() });
  await db.collection('usuarios').doc('ssur').set({ negocio_id: '2', nombre: 'Sonia Sur', password_hash: hash, salt, rol: 'admin', activo: 1, creado_en: new Date().toISOString() });

  const server = require('../server');
  await server.iniciar(db, FieldValue);
  const cookie1 = cookieDe(await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usuario: 'mbulon', password: 'desarme2026' }) }));
  const cookie2 = cookieDe(await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usuario: 'ssur', password: 'desarme2026' }) }));

  // Repuesto propio del negocio 1 (NO debería verlo en su propio marketplace)
  await fetch(`${BASE}/api/inventario`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie1 }, body: JSON.stringify({ nombre: 'Alternador Hilux', categoria: 'Motor', cantidad_disponible: 2, precio_venta: 65000 }) });
  // Repuesto del negocio 2 (sí debería aparecer en el marketplace del negocio 1)
  await fetch(`${BASE}/api/inventario`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie2 }, body: JSON.stringify({ nombre: 'Caja de cambios Sail', categoria: 'Transmisión', cantidad_disponible: 1, precio_venta: 180000 }) });
  // Repuesto sin stock del negocio 2 (NO debería aparecer)
  await fetch(`${BASE}/api/inventario`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie2 }, body: JSON.stringify({ nombre: 'Sin stock', categoria: 'Otro', cantidad_disponible: 0, precio_venta: 1000 }) });

  // Marketplace del negocio 1: debe ver solo lo del negocio 2 (con stock)
  let r = await fetch(`${BASE}/api/marketplace/buscar`, { headers: { Cookie: cookie1 } });
  const resultados = await r.json();
  assert.strictEqual(resultados.length, 1);
  assert.strictEqual(resultados[0].nombre, 'Caja de cambios Sail');
  assert.strictEqual(resultados[0].negocio_nombre, 'Repuestos Sur Desarme');

  // Lista de negocios: no debe incluirse a sí mismo ni al negocio inactivo
  r = await fetch(`${BASE}/api/marketplace/negocios`, { headers: { Cookie: cookie1 } });
  const negocios = await r.json();
  assert.strictEqual(negocios.length, 1);
  assert.strictEqual(negocios[0].nombre, 'Repuestos Sur Desarme');

  // Negocio 1 inicia una conversación con negocio 2
  r = await fetch(`${BASE}/api/chat/conversaciones`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie1 }, body: JSON.stringify({ negocio_id: '2' }) });
  assert.strictEqual(r.status, 200);
  const conv = await r.json();
  assert.strictEqual(conv.otro_negocio_nombre, 'Repuestos Sur Desarme');

  // Negocio 1 manda un mensaje
  r = await fetch(`${BASE}/api/chat/conversaciones/${conv.id}/mensajes`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie1 }, body: JSON.stringify({ mensaje: '¿Tienen la caja de cambios disponible?' }) });
  assert.strictEqual(r.status, 201);

  // Negocio 2 ve la conversación con 1 mensaje no leído, y al leerla queda en 0
  r = await fetch(`${BASE}/api/chat/conversaciones`, { headers: { Cookie: cookie2 } });
  let listaConv2 = await r.json();
  assert.strictEqual(listaConv2.length, 1);
  assert.strictEqual(listaConv2[0].no_leidos, 1);
  assert.strictEqual(listaConv2[0].ultimo_mensaje.mensaje, '¿Tienen la caja de cambios disponible?');

  await fetch(`${BASE}/api/chat/conversaciones/${conv.id}/mensajes`, { headers: { Cookie: cookie2 } }); // GET marca como leído
  r = await fetch(`${BASE}/api/chat/conversaciones`, { headers: { Cookie: cookie2 } });
  listaConv2 = await r.json();
  assert.strictEqual(listaConv2[0].no_leidos, 0);

  // Negocio 2 responde
  r = await fetch(`${BASE}/api/chat/conversaciones/${conv.id}/mensajes`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie2 }, body: JSON.stringify({ mensaje: 'Sí, nos queda una.' }) });
  assert.strictEqual(r.status, 201);

  // Reusar la conversación existente (no crear una nueva) al "crear" otra vez entre los mismos dos
  r = await fetch(`${BASE}/api/chat/conversaciones`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie1 }, body: JSON.stringify({ negocio_id: '2' }) });
  assert.strictEqual((await r.json()).id, conv.id);

  // Un tercer negocio NO debería poder leer esta conversación
  const { hash: hash3, salt: salt3 } = auth.hashPassword('desarme2026');
  await db.collection('usuarios').doc('cnorte').set({ negocio_id: '3', nombre: 'Carla Norte', password_hash: hash3, salt: salt3, rol: 'admin', activo: 1, creado_en: new Date().toISOString() });
  // (el negocio 3 está inactivo en /negocios, pero el login no depende de eso — probamos aislamiento del chat igual)
  await db.collection('negocios').doc('3').update({ activo: 1 });
  const cookie3 = cookieDe(await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usuario: 'cnorte', password: 'desarme2026' }) }));
  r = await fetch(`${BASE}/api/chat/conversaciones/${conv.id}/mensajes`, { headers: { Cookie: cookie3 } });
  assert.strictEqual(r.status, 404);

  console.log('✅ Todas las pruebas de marketplace/chat pasaron.');
  server.server.close();
  process.exit(0);
})().catch((e) => {
  console.error('❌ Falló la prueba:', e);
  process.exit(1);
});
