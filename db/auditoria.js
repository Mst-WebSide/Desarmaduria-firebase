// Bitácora de auditoría en Firestore: una subcolección por negocio
// (/negocios/{negocioId}/auditoria/{id autogenerado}), igual de aislada entre
// negocios que el resto de los datos. Misma lista de ACCIONES que la versión
// SQL — mantenerla sincronizada con los registrar(...) de server.js y con
// public/js/auditoria.js (ACCION_LABEL/ACCION_BADGE) en el frontend.
const ACCIONES = {
  venta_creada: 'Venta registrada',
  venta_anulada: 'Venta anulada',
  vehiculo_creado: 'Vehículo ingresado',
  vehiculo_desarmado: 'Vehículo marcado como desarmado',
  vehiculo_editado: 'Vehículo editado',
  inventario_creado: 'Repuesto creado',
  inventario_editado: 'Repuesto editado',
  inventario_eliminado: 'Repuesto eliminado',
  repisa_creada: 'Repisa creada/eliminada',
  repisa_editada: 'Repisa editada',
  bodega_compra_creada: 'Compra bodega registrada',
  bodega_compra_editada: 'Compra bodega editada',
  bodega_inventario_creado: 'Repuesto de bodega creado',
  bodega_inventario_editado: 'Repuesto de bodega editado',
  bodega_inventario_eliminado: 'Repuesto de bodega eliminado',
  usuario_creado: 'Usuario creado',
  usuario_editado: 'Usuario editado',
  password_visto: 'Contraseña vista por un admin',
  password_desbloqueado: 'Ver contraseña desbloqueado con clave maestra',
  negocio_actualizado: 'Datos del negocio actualizados',
  carga_masiva: 'Carga masiva por Excel',
  catalogo_repuesto_eliminado: 'Repuesto sacado de la lista de una categoría',
  taller_orden_creada: 'Vehículo ingresado al taller',
  taller_orden_editada: 'Orden de taller editada',
  taller_orden_entregada: 'Vehículo entregado desde el taller',
};

function crearAuditoriaDb(db, ahora) {
  return {
    async registrar({ negocio_id, usuario, accion, entidad_tipo, entidad_id, detalle }) {
      try {
        await db
          .collection('negocios')
          .doc(String(negocio_id))
          .collection('auditoria')
          .add({
            usuario: usuario ? usuario.usuario : null,
            usuario_nombre: usuario ? usuario.nombre : null,
            rol: usuario ? usuario.rol : null,
            accion,
            entidad_tipo: entidad_tipo || null,
            entidad_id: entidad_id !== undefined ? entidad_id : null,
            detalle: detalle || null,
            fecha: ahora(),
          });
      } catch (e) {
        // La auditoría nunca debe hacer fallar la operación real que la originó.
        console.error('No se pudo registrar en la bitácora de auditoría:', e.message);
      }
    },

    async listarPorNegocio(negocioId) {
      const snap = await db.collection('negocios').doc(String(negocioId)).collection('auditoria').get();
      return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
    },
  };
}

module.exports = { crearAuditoriaDb, ACCIONES };
