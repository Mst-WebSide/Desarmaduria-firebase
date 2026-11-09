// Acceso a /negocios/{negocioId}/compras_bodega e inventario_bodega en
// Firestore. Mismo patrón "padre + hijos" que vehiculos -> inventario: el id
// de compras_bodega es su "numero" correlativo (igual razón que en
// db/vehiculos.js), y cada pieza de inventario_bodega guarda ese numero en
// "compra_id".
function crearBodegaDb(db) {
  const comprasCol = (negocioId) => db.collection('negocios').doc(String(negocioId)).collection('compras_bodega');
  const piezasCol = (negocioId) => db.collection('negocios').doc(String(negocioId)).collection('inventario_bodega');

  function filaDesdeSnap(snap) {
    if (!snap.exists) return null;
    return { id: snap.id, ...snap.data() };
  }

  return {
    // ---- compras_bodega ----
    async listarComprasPorNegocio(negocioId) {
      const snap = await comprasCol(negocioId).get();
      return snap.docs.map((d) => filaDesdeSnap(d)).sort((a, b) => (a.fecha_ingreso < b.fecha_ingreso ? 1 : -1));
    },

    async obtenerCompra(negocioId, numero) {
      const snap = await comprasCol(negocioId).doc(String(numero)).get();
      return filaDesdeSnap(snap);
    },

    async siguienteNumeroCompra(negocioId) {
      const snap = await comprasCol(negocioId).get();
      let max = 0;
      snap.docs.forEach((d) => {
        const n = Number(d.data().numero) || 0;
        if (n > max) max = n;
      });
      return max + 1;
    },

    async crearCompra(negocioId, numero, datos) {
      await comprasCol(negocioId)
        .doc(String(numero))
        .set({ ...datos, numero });
      return numero;
    },

    async actualizarCompra(negocioId, numero, cambios) {
      await comprasCol(negocioId).doc(String(numero)).update(cambios);
    },

    // ---- inventario_bodega ----
    async listarPiezasPorNegocio(negocioId) {
      const snap = await piezasCol(negocioId).get();
      return snap.docs.map((d) => filaDesdeSnap(d));
    },

    async listarPorCompra(negocioId, compraId) {
      const snap = await piezasCol(negocioId).where('compra_id', '==', compraId).get();
      return snap.docs.map((d) => filaDesdeSnap(d)).sort((a, b) => a.nombre.localeCompare(b.nombre));
    },

    async listarPorRepisa(negocioId, repisaId) {
      const snap = await piezasCol(negocioId).where('repisa_id', '==', repisaId).get();
      return snap.docs.map((d) => filaDesdeSnap(d));
    },

    async obtenerPieza(negocioId, id) {
      const snap = await piezasCol(negocioId).doc(id).get();
      return filaDesdeSnap(snap);
    },

    async crearPieza(negocioId, datos) {
      const ref = piezasCol(negocioId).doc();
      await ref.set(datos);
      return ref.id;
    },

    async actualizarPieza(negocioId, id, cambios) {
      await piezasCol(negocioId).doc(id).update(cambios);
    },

    async eliminarPieza(negocioId, id) {
      await piezasCol(negocioId).doc(id).delete();
    },

    async contarPiezaEnVentas(negocioId, inventarioBodegaId) {
      const snap = await db.collection('negocios').doc(String(negocioId)).collection('ventas').get();
      let n = 0;
      snap.docs.forEach((d) => {
        const items = d.data().items || [];
        n += items.filter((it) => it.inventario_bodega_id === inventarioBodegaId).length;
      });
      return n;
    },
  };
}

module.exports = { crearBodegaDb };
