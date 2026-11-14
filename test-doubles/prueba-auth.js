// Prueba de extremo a extremo (HTTP real, contra el Firestore falso) del
// primer bloque portado: login, /me, cambiar-password, usuarios (listar,
// crear, editar), negocio, logout. Si todo esto pasa, el primer pedazo de la
// migración (auth + usuarios + negocio) está funcionalmente correcto.
const assert = require('assert');
const crypto = require('crypto');
const { FirestoreFalso, FieldValue } = require('./fake-firestore');
const auth = require('../auth');

const PUERTO = 3457;
process.env.PORT = String(PUERTO);
const BASE = `http://localhost:${PUERTO}`;

function cookieDe(res) {
  const set = res.headers.get('set-cookie');
  return set ? set.split(';')[0] : null;
}

(async () => {
  const db = new FirestoreFalso();

  // Seed mínimo equivalente a negocio 1 / usuario mbulon de la base real.
  await db.collection('negocios').doc('1').set({
    nombre: 'Desarmaduría Quillota',
    rut: '76.111.222-3',
    telefono_dueno: '+56911111111',
    email_contacto: 'contacto@quillota.cl',
    direccion: 'Av. Industrial 450, Quillota',
    plan: 'demo',
    activo: 1,
    creado_en: new Date().toISOString(),
  });
  const { hash, salt } = auth.hashPassword('desarme2026');
  await db.collection('usuarios').doc('mbulon').set({
    negocio_id: '1',
    nombre: 'Marta Bulón',
    password_hash: hash,
    salt,
    rol: 'admin',
    activo: 1,
    debe_cambiar_password: 1,
    password_plana: null,
    intentos_ver_password: 0,
    bloqueado_ver_password: 0,
    creado_en: new Date().toISOString(),
  });

  const server = require('../server');
  await server.iniciar(db, FieldValue);

  // 1) login con clave incorrecta -> 401
  let r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usuario: 'mbulon', password: 'mala' }) });
  assert.strictEqual(r.status, 401);

  // 2) login correcto -> cookie de sesión
  r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usuario: 'mbulon', password: 'desarme2026' }) });
  assert.strictEqual(r.status, 200);
  const cuerpoLogin = await r.json();
  assert.strictEqual(cuerpoLogin.nombre, 'Marta Bulón');
  assert.strictEqual(cuerpoLogin.debe_cambiar_password, true);
  const cookie = cookieDe(r);
  assert.ok(cookie, 'debería haber recibido una cookie de sesión');

  // 3) /api/auth/me devuelve usuario + negocio (el "JOIN" ahora son 2 lecturas)
  r = await fetch(`${BASE}/api/auth/me`, { headers: { Cookie: cookie } });
  assert.strictEqual(r.status, 200);
  const me = await r.json();
  assert.strictEqual(me.usuario, 'mbulon');
  assert.strictEqual(me.negocio.nombre, 'Desarmaduría Quillota');

  // 4) sin cookie -> 401
  r = await fetch(`${BASE}/api/auth/me`);
  assert.strictEqual(r.status, 401);

  // 5) cambiar-password con la actual mal -> 400
  r = await fetch(`${BASE}/api/auth/cambiar-password`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ passwordActual: 'mala', passwordNueva: 'nueva123' }) });
  assert.strictEqual(r.status, 400);

  // 6) cambiar-password correcto -> debe_cambiar_password pasa a false
  r = await fetch(`${BASE}/api/auth/cambiar-password`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ passwordActual: 'desarme2026', passwordNueva: 'nueva123' }) });
  assert.strictEqual(r.status, 200);
  r = await fetch(`${BASE}/api/auth/me`, { headers: { Cookie: cookie } });
  assert.strictEqual((await r.json()).debe_cambiar_password, false);

  // 7) crear un usuario nuevo (mecánico) y que la lista lo muestre sin campos sensibles
  r = await fetch(`${BASE}/api/usuarios`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ nombre: 'Pedro Rojas', rol: 'mecanico_lider' }) });
  assert.strictEqual(r.status, 201);
  const creado = await r.json();
  assert.strictEqual(creado.usuario, 'projas');
  assert.ok(creado.passwordTemporal);

  r = await fetch(`${BASE}/api/usuarios`, { headers: { Cookie: cookie } });
  const lista = await r.json();
  assert.strictEqual(lista.length, 2);
  const projas = lista.find((u) => u.usuario === 'projas');
  assert.ok(projas, 'projas debería estar en la lista');
  assert.strictEqual(projas.password_hash, undefined, 'la lista NUNCA debe exponer password_hash');

  // 8) editar ese usuario (desactivarlo) y ver que el cambio se refleje
  r = await fetch(`${BASE}/api/usuarios/projas`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ activo: false }) });
  assert.strictEqual(r.status, 200);
  r = await fetch(`${BASE}/api/usuarios`, { headers: { Cookie: cookie } });
  const projasActualizado = (await r.json()).find((u) => u.usuario === 'projas');
  assert.strictEqual(projasActualizado.activo, 0);

  // 9) un usuario de OTRO negocio no debería poder editarse desde este negocio (aislamiento)
  await db.collection('usuarios').doc('intruso').set({ negocio_id: '2', nombre: 'Intruso', rol: 'mecanico', activo: 1, password_hash: 'x', salt: 'x', creado_en: new Date().toISOString() });
  r = await fetch(`${BASE}/api/usuarios/intruso`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ activo: false }) });
  assert.strictEqual(r.status, 404, 'no debe poder tocar un usuario de otro negocio');

  // 10) actualizar datos del negocio
  r = await fetch(`${BASE}/api/negocio`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ telefono_dueno: '+56999999999' }) });
  assert.strictEqual(r.status, 200);
  assert.strictEqual((await r.json()).telefono_dueno, '+56999999999');

  // 11) logout y que la sesión ya no sirva
  r = await fetch(`${BASE}/api/auth/logout`, { method: 'POST', headers: { Cookie: cookie } });
  assert.strictEqual(r.status, 200);
  r = await fetch(`${BASE}/api/auth/me`, { headers: { Cookie: cookie } });
  assert.strictEqual(r.status, 401);

  console.log('✅ Todas las pruebas de auth/usuarios/negocio contra Firestore pasaron.');
  server.server.close();
  process.exit(0);
})().catch((e) => {
  console.error('❌ Falló la prueba:', e);
  process.exit(1);
});
