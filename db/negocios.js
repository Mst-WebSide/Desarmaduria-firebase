// Acceso a la colección /negocios en Firestore. Los negocios no se crean
// desde la API (solo existen los que vengan de la migración de datos o de un
// futuro registro público — ver comentario en el seed original), así que acá
// solo hace falta leer y actualizar.
function crearNegociosDb(db) {
  const coleccion = () => db.collection('negocios');

  return {
    async obtenerPorId(id) {
      const snap = await coleccion().doc(String(id)).get();
      return snap.exists ? { id: snap.id, ...snap.data() } : null;
    },

    // Solo la usa el marketplace (necesita ver TODOS los negocios activos
    // para cruzar sus inventarios) — en todo el resto del sistema cada
    // negocio solo puede ver y tocar lo suyo.
    async listarTodos() {
      const snap = await coleccion().get();
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },

    async actualizar(id, cambios) {
      await coleccion().doc(String(id)).update(cambios);
    },

    // Solo lo usa el script de migración (db/negocios.js no se llama desde
    // ninguna ruta de server.js para crear negocios nuevos).
    async crear(id, datos) {
      await coleccion().doc(String(id)).set(datos);
    },
  };
}

module.exports = { crearNegociosDb };
