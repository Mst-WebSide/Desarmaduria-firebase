// Acceso a /negocios/{negocioId}/vehiculos en Firestore.
//
// El id del documento es el propio "numero" correlativo (Vehículo 1,
// Vehículo 2...) en vez de un id autoincremental aparte — como "numero" ya
// era único por negocio y nunca cambia después de creado (ver comentario
// original en schema.sql), sirve perfecto como identificador, y de paso
// hace innecesaria la doble numeración (id interno + numero) que tenía la
// versión SQL. El campo "numero" se guarda también adentro del documento
// (no solo como id) para poder ordenar/filtrar por él sin depender de que
// los ids de Firestore ordenen como números.
function crearVehiculosDb(db) {
  const coleccion = (negocioId) => db.collection('negocios').doc(String(negocioId)).collection('vehiculos');

  function filaDesdeSnap(snap) {
    if (!snap.exists) return null;
    return { id: snap.id, ...snap.data() };
  }

  return {
    async listarPorNegocio(negocioId) {
      const snap = await coleccion(negocioId).get();
      return snap.docs.map((d) => filaDesdeSnap(d)).sort((a, b) => (a.fecha_ingreso < b.fecha_ingreso ? 1 : -1));
    },

    async obtener(negocioId, numero) {
      const snap = await coleccion(negocioId).doc(String(numero)).get();
      return filaDesdeSnap(snap);
    },

    async existeNumero(negocioId, numero) {
      const snap = await coleccion(negocioId).doc(String(numero)).get();
      return snap.exists;
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

module.exports = { crearVehiculosDb };
