// Acceso a /negocios/{negocioId}/inventario en Firestore.
//
// "vehiculo_id" guarda el "numero" (string) del vehículo del que salió el
// repuesto — ya no hay un id autoincremental de vehículo distinto del
// número correlativo (ver db/vehiculos.js), así que no hace falta traducir
// nada al guardar esta referencia.
//
// Las fotos NO se guardan acá: este módulo solo guarda las URLs
// (foto_1/foto_2/foto_3), ya subidas a Cloud Storage por quien llama (ver
// db/storage.js) — así este archivo no necesita saber nada de archivos.
function crearInventarioDb(db) {
  const coleccion = (negocioId) => db.collection('negocios').doc(String(negocioId)).collection('inventario');

  function filaDesdeSnap(snap) {
    if (!snap.exists) return null;
    return { id: snap.id, ...snap.data() };
  }

  return {
    async listarPorNegocio(negocioId) {
      const snap = await coleccion(negocioId).get();
      return snap.docs.map((d) => filaDesdeSnap(d));
    },

    async listarPorVehiculo(negocioId, vehiculoId) {
      const snap = await coleccion(negocioId).where('vehiculo_id', '==', vehiculoId).get();
      return snap.docs.map((d) => filaDesdeSnap(d)).sort((a, b) => a.nombre.localeCompare(b.nombre));
    },

    async contarEnVentas(negocioId, inventarioId) {
      // Firestore no puede filtrar por un campo DENTRO de un array de objetos
      // (los ítems de cada venta van embebidos, ver db/ventas.js), así que se
      // recorren las ventas del negocio en memoria — aceptable a la escala de
      // una desarmaduría (cientos/miles de ventas, no millones).
      const snap = await db.collection('negocios').doc(String(negocioId)).collection('ventas').get();
      let n = 0;
      snap.docs.forEach((d) => {
        const items = d.data().items || [];
        n += items.filter((it) => it.inventario_id === inventarioId).length;
      });
      return n;
    },

    async obtener(negocioId, id) {
      const snap = await coleccion(negocioId).doc(id).get();
      return filaDesdeSnap(snap);
    },

    async crear(negocioId, datos) {
      const ref = coleccion(negocioId).doc();
      await ref.set(datos);
      return ref.id;
    },

    async actualizar(negocioId, id, cambios) {
      await coleccion(negocioId).doc(id).update(cambios);
    },

    async eliminar(negocioId, id) {
      await coleccion(negocioId).doc(id).delete();
    },
  };
}

module.exports = { crearInventarioDb };
