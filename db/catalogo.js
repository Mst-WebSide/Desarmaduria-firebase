// Acceso a /negocios/{negocioId}/catalogo_repuestos en Firestore. Firestore
// no compara texto sin importar mayúsculas en una consulta, así que la
// búsqueda "¿ya existe este nombre en esta categoría?" se hace trayendo los
// de esa categoría (normalmente pocos) y comparando en JavaScript — igual
// que hacía el "lower(nombre) = lower(?)" de la versión SQL.
function crearCatalogoDb(db) {
  const coleccion = (negocioId) => db.collection('negocios').doc(String(negocioId)).collection('catalogo_repuestos');

  function filaDesdeSnap(snap) {
    if (!snap.exists) return null;
    return { id: snap.id, ...snap.data() };
  }

  return {
    async listarPorNegocio(negocioId) {
      const snap = await coleccion(negocioId).get();
      return snap.docs.map((d) => filaDesdeSnap(d));
    },

    async buscar(negocioId, categoria, nombre) {
      const snap = await coleccion(negocioId).where('categoria', '==', categoria).get();
      const nombreLower = nombre.toLowerCase();
      const fila = snap.docs.find((d) => (d.data().nombre || '').toLowerCase() === nombreLower);
      return fila ? filaDesdeSnap(fila) : null;
    },

    async crear(negocioId, datos) {
      const ref = coleccion(negocioId).doc();
      await ref.set(datos);
      return ref.id;
    },

    async marcarOculto(negocioId, id, oculto) {
      await coleccion(negocioId).doc(id).update({ oculto });
    },

    async eliminar(negocioId, id) {
      await coleccion(negocioId).doc(id).delete();
    },
  };
}

module.exports = { crearCatalogoDb };
