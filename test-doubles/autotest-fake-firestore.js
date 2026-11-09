// Prueba rápida del Firestore falso antes de construir el adaptador encima.
const assert = require('assert');
const { FirestoreFalso, FieldValue } = require('./fake-firestore');

(async () => {
  const db = new FirestoreFalso();

  // set/get simple con id elegido a mano (como usuarios, doc id = username)
  await db.collection('usuarios').doc('mbulon').set({ nombre: 'Marta Bulón', rol: 'admin' });
  const snap = await db.collection('usuarios').doc('mbulon').get();
  assert.strictEqual(snap.exists, true);
  assert.strictEqual(snap.data().nombre, 'Marta Bulón');

  // doc inexistente
  const snapNo = await db.collection('usuarios').doc('noexiste').get();
  assert.strictEqual(snapNo.exists, false);
  assert.strictEqual(snapNo.data(), undefined);

  // subcolecciones anidadas (negocios/{id}/vehiculos/{numero})
  const negocioRef = db.collection('negocios').doc('1');
  await negocioRef.set({ nombre: 'Desarmaduría Quillota' });
  await negocioRef.collection('vehiculos').doc('1').set({ patente: 'ABCD11', estado: 'en_desarme' });
  await negocioRef.collection('vehiculos').doc('2').set({ patente: 'EFGH22', estado: 'desarmado' });
  const vehiculos = await negocioRef.collection('vehiculos').get();
  assert.strictEqual(vehiculos.size, 2);

  // where + orderBy + limit
  const enDesarme = await negocioRef.collection('vehiculos').where('estado', '==', 'en_desarme').get();
  assert.strictEqual(enDesarme.size, 1);
  assert.strictEqual(enDesarme.docs[0].id, '1');

  // update (merge parcial) y que no se pierdan los otros campos
  await negocioRef.collection('vehiculos').doc('1').update({ color: 'Blanco' });
  const v1 = await negocioRef.collection('vehiculos').doc('1').get();
  assert.strictEqual(v1.data().patente, 'ABCD11');
  assert.strictEqual(v1.data().color, 'Blanco');

  // FieldValue.increment (contadores del negocio, sin leer antes)
  await negocioRef.set({ ventas_total: 0 }, { merge: true });
  await negocioRef.update({ ventas_total: FieldValue.increment(5000) });
  await negocioRef.update({ ventas_total: FieldValue.increment(1500) });
  const n1 = await negocioRef.get();
  assert.strictEqual(n1.data().ventas_total, 6500);

  // transacción: leer y escribir en la misma operación
  await db.runTransaction(async (tx) => {
    const ref = negocioRef.collection('vehiculos').doc('2');
    const actual = await tx.get(ref);
    assert.strictEqual(actual.data().estado, 'desarmado');
    tx.update(ref, { observaciones: 'revisado en transacción' });
  });
  const v2 = await negocioRef.collection('vehiculos').doc('2').get();
  assert.strictEqual(v2.data().observaciones, 'revisado en transacción');

  // delete
  await negocioRef.collection('vehiculos').doc('2').delete();
  const v2b = await negocioRef.collection('vehiculos').doc('2').get();
  assert.strictEqual(v2b.exists, false);
  const todos = await negocioRef.collection('vehiculos').get();
  assert.strictEqual(todos.size, 1);

  // add() con id autogenerado
  const añadido = await negocioRef.collection('ventas').add({ total: 1000 });
  assert.ok(añadido.id);
  const ventaLeida = await añadido.get();
  assert.strictEqual(ventaLeida.data().total, 1000);

  // collectionGroup: debe encontrar documentos de la misma subcolección bajo
  // negocios DISTINTOS, y .ref.parent.parent.id debe dar el id del negocio
  // dueño de cada uno (igual que en el SDK real).
  await db.collection('negocios').doc('2').set({ nombre: 'Otro negocio' });
  await db.collection('negocios').doc('2').collection('vehiculos').doc('1').set({ patente: 'ZZZZ99', estado: 'en_desarme' });
  const grupo = await db.collectionGroup('vehiculos').get();
  assert.strictEqual(grupo.size, 2); // el vehículo 1 del negocio "1" (ya editado arriba) + este del negocio "2"
  const porNegocio = {};
  grupo.docs.forEach((d) => {
    porNegocio[d.ref.parent.parent.id] = d.data().patente;
  });
  assert.strictEqual(porNegocio['1'], 'ABCD11');
  assert.strictEqual(porNegocio['2'], 'ZZZZ99');

  console.log('✅ Todas las pruebas del Firestore falso pasaron.');
})().catch((e) => {
  console.error('❌ Falló la prueba del Firestore falso:', e);
  process.exit(1);
});
