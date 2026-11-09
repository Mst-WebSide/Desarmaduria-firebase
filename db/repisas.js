// Acceso a /negocios/{negocioId}/repisas en Firestore.
function crearRepisasDb(db, inventarioBodegaDb) {
  const coleccion = (negocioId) => db.collection('negocios').doc(String(negocioId)).collection('repisas');

  function filaDesdeSnap(snap) {
    if (!snap.exists) return null;
    return { id: snap.id, ...snap.data() };
  }

  return {
    async listarPorNegocio(negocioId) {
      const snap = await coleccion(negocioId).get();
      return snap.docs.map((d) => filaDesdeSnap(d)).sort((a, b) => a.nombre.localeCompare(b.nombre));
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

    // Reemplaza el "LEFT JOIN + MAX(fila)/COUNT(*) WHERE repisa_id = ?" de la
    // versión SQL: se apoya en inventario_bodega (inyectado) para no
    // depender de una consulta cruzada que Firestore no puede hacer.
    async filaMaximaEnUso(negocioId, repisaId) {
      const piezas = await inventarioBodegaDb.listarPorRepisa(negocioId, repisaId);
      return piezas.reduce((max, p) => Math.max(max, Number(p.fila) || 0), 0);
    },

    async contarEnUso(negocioId, repisaId) {
      const piezas = await inventarioBodegaDb.listarPorRepisa(negocioId, repisaId);
      return piezas.length;
    },
  };
}

module.exports = { crearRepisasDb };
