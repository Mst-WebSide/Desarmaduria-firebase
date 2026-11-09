// Prueba de extremo a extremo de la carga masiva por Excel: la plantilla se
// puede descargar y tiene las hojas correctas, un archivo válido con los
// tres casos de "Inventario" (repuesto genérico, ligado a vehículo
// existente, y vehículo nuevo agrupado por N°) y "Inventario Bodega"
// (agrupado por "Nombre de compra", con repisa) crea todo lo esperado, y un
// archivo con un solo error no guarda absolutamente nada.
const assert = require('assert');
const ExcelJS = require('exceljs');
const { FirestoreFalso, FieldValue } = require('./fake-firestore');
const { crearStorageFalso } = require('./fake-storage');
const auth = require('../auth');

const PUERTO = 3464;
process.env.PORT = String(PUERTO);
const BASE = `http://localhost:${PUERTO}`;

function cookieDe(res) {
  const set = res.headers.get('set-cookie');
  return set ? set.split(';')[0] : null;
}

async function construirWorkbook({ filasInventario, filasBodega }) {
  const wb = new ExcelJS.Workbook();
  if (filasInventario) {
    const hoja = wb.addWorksheet('Inventario');
    hoja.addRow([]); // encabezado (fila 1, el contenido no importa para la carga)
    filasInventario.forEach((f) => hoja.addRow(f));
  }
  if (filasBodega) {
    const hoja = wb.addWorksheet('Inventario Bodega');
    hoja.addRow([]);
    filasBodega.forEach((f) => hoja.addRow(f));
  }
  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer).toString('base64');
}

(async () => {
  const db = new FirestoreFalso();
  const storage = crearStorageFalso({ carpeta: '/tmp/desarmaduria-storage-falso-carga-masiva', urlBase: 'http://localhost:9999/fake-storage' });
  await db.collection('negocios').doc('1').set({ nombre: 'Desarmaduría Quillota', activo: 1 });
  const { hash, salt } = auth.hashPassword('desarme2026');
  await db.collection('usuarios').doc('mbulon').set({ negocio_id: '1', nombre: 'Marta Bulón', password_hash: hash, salt, rol: 'admin', activo: 1, creado_en: new Date().toISOString() });

  const server = require('../server');
  await server.iniciar(db, storage, FieldValue);
  const cookie = cookieDe(await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usuario: 'mbulon', password: 'desarme2026' }) }));

  // ---- Plantilla descargable ----
  let r = await fetch(`${BASE}/api/carga-masiva/plantilla`, { headers: { Cookie: cookie } });
  assert.strictEqual(r.status, 200);
  assert.ok((r.headers.get('content-type') || '').includes('spreadsheetml'));
  const bufferPlantilla = Buffer.from(await r.arrayBuffer());
  const wbPlantilla = new ExcelJS.Workbook();
  await wbPlantilla.xlsx.load(bufferPlantilla);
  assert.ok(wbPlantilla.getWorksheet('Inventario'));
  assert.ok(wbPlantilla.getWorksheet('Inventario Bodega'));
  assert.ok(wbPlantilla.getWorksheet('Instrucciones'));

  // ---- Datos previos: un vehículo existente y una repisa ----
  r = await fetch(`${BASE}/api/vehiculos`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ numero: 1, patente: 'aaa111', marca: 'Toyota' }) });
  const vehiculoExistente = await r.json();
  assert.strictEqual(vehiculoExistente.numero, 1);

  r = await fetch(`${BASE}/api/repisas`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ nombre: 'Estante A', cantidad_filas: 5 }) });
  await r.json();

  // ---- Archivo con un error: no debe guardar nada ----
  let base64Malo = await construirWorkbook({
    filasInventario: [['', '', '', '', '', '', 'Repuesto malo', 'Categoría que no existe', '', 1, 1, 1000, 500, '']],
  });
  r = await fetch(`${BASE}/api/carga-masiva`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ archivo: base64Malo }) });
  assert.strictEqual(r.status, 400);
  const cuerpoError = await r.json();
  assert.ok(cuerpoError.errores.length >= 1);

  r = await fetch(`${BASE}/api/inventario`, { headers: { Cookie: cookie } });
  assert.strictEqual((await r.json()).length, 0); // nada se guardó

  // ---- Archivo válido: los tres casos de Inventario + Inventario Bodega agrupada ----
  const base64Bueno = await construirWorkbook({
    filasInventario: [
      // Caso 1: genérico, sin vehículo
      ['', '', '', '', '', '', 'Bujía genérica', 'Eléctrico', '', 4, 1, 3000, 1000, ''],
      // Caso 2: ligado al vehículo N°1 ya existente
      [1, '', '', '', '', '', 'Rueda trasera', 'Neumáticos', '', 2, 1, 20000, 10000, ''],
      // Caso 3: vehículo N°50 nuevo, dos filas agrupadas (solo la primera trae los datos del vehículo)
      [50, 'Hyundai', 'Accent', 2010, 'Compra a particular', 'Choque frontal', 'Motor completo', 'Motor', '', 1, 1, 300000, 150000, 'Estante B-1'],
      [50, '', '', '', '', '', 'Caja de cambios', 'Transmisión', '', 1, 1, 180000, 90000, ''],
    ],
    filasBodega: [
      ['Compra Prueba', 'Tornillo', 'Otro', '', 100, 10, 500, 100, 'Estante A', 2, 'Ferretería Sur', 50000, 'Compra masiva de prueba'],
      ['Compra Prueba', 'Tuerca', 'Otro', '', 200, 20, 300, 80, '', '', '', '', ''],
    ],
  });
  r = await fetch(`${BASE}/api/carga-masiva`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ archivo: base64Bueno }) });
  assert.strictEqual(r.status, 200);
  const resultado = await r.json();
  assert.strictEqual(resultado.creados_vehiculos, 1);
  assert.strictEqual(resultado.creados_inventario, 4);
  assert.strictEqual(resultado.creadas_compras_bodega, 1);
  assert.strictEqual(resultado.creadas_piezas_bodega, 2);

  // El vehículo nuevo se creó con el N° exacto pedido (50), no autoincremental
  r = await fetch(`${BASE}/api/vehiculos/50`, { headers: { Cookie: cookie } });
  assert.strictEqual(r.status, 200);
  const vehiculoNuevo = await r.json();
  assert.strictEqual(vehiculoNuevo.marca, 'Hyundai');
  assert.strictEqual(vehiculoNuevo.observaciones, 'Choque frontal');
  assert.strictEqual(vehiculoNuevo.repuestos.length, 2); // Motor completo + Caja de cambios

  // El repuesto ligado al vehículo existente quedó bien ligado
  r = await fetch(`${BASE}/api/inventario?q=Rueda`, { headers: { Cookie: cookie } });
  const [ruedaTrasera] = await r.json();
  assert.strictEqual(String(ruedaTrasera.vehiculo_id), '1');

  // La compra de bodega agrupó ambas piezas, con los datos de compra tomados de la primera fila del grupo
  r = await fetch(`${BASE}/api/bodega/compras`, { headers: { Cookie: cookie } });
  const compras = await r.json();
  const compraPrueba = compras.find((c) => c.nombre === 'Compra Prueba');
  assert.ok(compraPrueba);
  assert.strictEqual(compraPrueba.proveedor, 'Ferretería Sur');
  assert.strictEqual(compraPrueba.costo_total, 50000);

  r = await fetch(`${BASE}/api/bodega/compras/${compraPrueba.id}`, { headers: { Cookie: cookie } });
  const compraConPiezas = await r.json();
  assert.strictEqual(compraConPiezas.piezas.length, 2);
  const tornillo = compraConPiezas.piezas.find((p) => p.nombre === 'Tornillo');
  assert.strictEqual(tornillo.repisa_nombre, 'Estante A');
  assert.strictEqual(tornillo.fila, 2);

  // ---- Fila de bodega con repisa inexistente: error, sin guardar nada más ----
  const base64RepisaInvalida = await construirWorkbook({
    filasBodega: [['Otra compra', 'Pieza X', 'Otro', '', 1, 1, 1000, 500, 'Repisa que no existe', 1, '', '', '']],
  });
  r = await fetch(`${BASE}/api/carga-masiva`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ archivo: base64RepisaInvalida }) });
  assert.strictEqual(r.status, 400);

  r = await fetch(`${BASE}/api/bodega/compras`, { headers: { Cookie: cookie } });
  assert.strictEqual((await r.json()).length, 1); // sigue habiendo solo "Compra Prueba"

  console.log('✅ Todas las pruebas de carga masiva por Excel pasaron.');
  server.server.close();
  process.exit(0);
})().catch((e) => {
  console.error('❌ Falló la prueba:', e);
  process.exit(1);
});
