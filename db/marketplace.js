// Búsqueda entre negocios: a propósito es la ÚNICA parte del sistema que
// cruza negocios (ver nota en server.js). Usa collectionGroup para buscar en
// el inventario de TODOS los negocios a la vez — Firestore no tiene un
// equivalente a "LIKE" para texto libre, así que ese filtro se aplica en
// JavaScript después de traer los candidatos (activo=1, con stock) desde el
// servidor.
function crearMarketplaceDb(db, negociosDb) {
  return {
    async buscarRepuestos(negocioIdPropio, { q, categoria } = {}) {
      const snap = await db.collectionGroup('inventario').where('activo', '==', 1).get();
      const negocios = await negociosDb.listarTodos();
      const negociosPorId = new Map(negocios.filter((n) => n.activo && String(n.id) !== String(negocioIdPropio)).map((n) => [String(n.id), n]));

      const qLower = (q || '').toLowerCase();
      const resultados = [];
      for (const doc of snap.docs) {
        const item = doc.data();
        if (!item.cantidad_disponible || item.cantidad_disponible <= 0) continue;
        const negocioId = doc.ref.parent.parent.id;
        const negocio = negociosPorId.get(String(negocioId));
        if (!negocio) continue; // es del propio negocio, o de un negocio inactivo/eliminado
        if (qLower && !(item.nombre || '').toLowerCase().includes(qLower)) continue;
        if (categoria && item.categoria !== categoria) continue;
        resultados.push({
          id: doc.id,
          nombre: item.nombre,
          categoria: item.categoria,
          cantidad_disponible: item.cantidad_disponible,
          precio_venta: item.precio_venta,
          foto_1: item.foto_1 || null,
          negocio_id: negocioId,
          negocio_nombre: negocio.nombre,
          telefono_dueno: negocio.telefono_dueno,
        });
      }
      resultados.sort((a, b) => a.negocio_nombre.localeCompare(b.negocio_nombre) || a.nombre.localeCompare(b.nombre));
      return resultados.slice(0, 100);
    },

    async listarOtrosNegocios(negocioIdPropio) {
      const negocios = await negociosDb.listarTodos();
      return negocios
        .filter((n) => n.activo && String(n.id) !== String(negocioIdPropio))
        .map((n) => ({ id: n.id, nombre: n.nombre, direccion: n.direccion }))
        .sort((a, b) => a.nombre.localeCompare(b.nombre));
    },
  };
}

module.exports = { crearMarketplaceDb };
