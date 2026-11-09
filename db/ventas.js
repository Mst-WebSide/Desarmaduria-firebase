// Acceso a /negocios/{negocioId}/ventas en Firestore. Los ítems de cada
// venta van embebidos como un array dentro del mismo documento (no una
// subcolección aparte) — ver DISEÑO-FIRESTORE.md: siempre se leen y escriben
// junto con la venta, nunca cambian después de creados (salvo anulación, que
// no toca los ítems) y no hay riesgo de pasarse del límite de 1MiB de un
// documento con una lista razonable de ítems vendidos.
function crearVentasDb(db) {
  const coleccion = (negocioId) => db.collection('negocios').doc(String(negocioId)).collection('ventas');

  function filaDesdeSnap(snap) {
    if (!snap.exists) return null;
    return { id: snap.id, ...snap.data() };
  }

  return {
    async listarPorNegocio(negocioId, { desde, hasta } = {}) {
      const snap = await coleccion(negocioId).get();
      let data = snap.docs.map((d) => filaDesdeSnap(d));
      if (desde) data = data.filter((v) => v.fecha >= desde);
      if (hasta) data = data.filter((v) => v.fecha <= hasta);
      data.sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
      return data.slice(0, 300);
    },

    // Para reportes/dashboard: a diferencia de listarPorNegocio (que recorta a
    // 300 para la vista de lista), acá se necesita el historial COMPLETO de
    // ventas para que sumas/promedios/gráficos salgan correctos.
    async listarTodasPorNegocio(negocioId, { desde, hasta } = {}) {
      const snap = await coleccion(negocioId).get();
      let data = snap.docs.map((d) => filaDesdeSnap(d));
      if (desde) data = data.filter((v) => v.fecha >= desde);
      if (hasta) data = data.filter((v) => v.fecha <= hasta);
      data.sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
      return data;
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
  };
}

module.exports = { crearVentasDb };
