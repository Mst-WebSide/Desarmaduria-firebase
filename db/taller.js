// Acceso a /negocios/{negocioId}/taller_ordenes en Firestore. Mismo patrón
// de id = "numero" correlativo que vehiculos/compras_bodega. Por decisión
// del usuario, esta versión NO lleva fotos (ver DISEÑO-FIRESTORE.md) — el
// PDF de entrega queda solo con los datos de texto.
function crearTallerDb(db) {
  const coleccion = (negocioId) => db.collection('negocios').doc(String(negocioId)).collection('taller_ordenes');

  function filaDesdeSnap(snap) {
    if (!snap.exists) return null;
    return { id: snap.id, ...snap.data() };
  }

  return {
    async listarPorNegocio(negocioId, estado) {
      let q = coleccion(negocioId);
      if (estado) q = q.where('estado', '==', estado);
      const snap = await q.get();
      return snap.docs.map((d) => filaDesdeSnap(d)).sort((a, b) => (a.fecha_ingreso < b.fecha_ingreso ? 1 : -1));
    },

    async obtener(negocioId, numero) {
      const snap = await coleccion(negocioId).doc(String(numero)).get();
      return filaDesdeSnap(snap);
    },

    async siguienteNumero(negocioId) {
      const snap = await coleccion(negocioId).get();
      let max = 0;
      snap.docs.forEach((d) => {
        const n = Number(d.data().numero) || 0;
        if (n > max) max = n;
      });
      return max + 1;
    },

    async crear(negocioId, numero, datos) {
      await coleccion(negocioId)
        .doc(String(numero))
        .set({ ...datos, numero });
      return numero;
    },

    async actualizar(negocioId, numero, cambios) {
      await coleccion(negocioId).doc(String(numero)).update(cambios);
    },
  };
}

module.exports = { crearTallerDb };
