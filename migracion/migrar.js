// Migra los datos reales desde la base SQLite del sistema actual (Windows,
// desarmaduria-erp-v7/db/desarmaduria.db) a Firestore.
//
// Reutiliza los mismos módulos db/*.js que usa server.js, así la migración
// escribe exactamente en las mismas colecciones/IDs que después leerá la
// API — no hay una segunda definición del modelo de datos que se pueda
// desincronizar con DISEÑO-FIRESTORE.md.
//
// Decisión del usuario (ver conversación): NO se migran los negocios de
// demostración ("Repuestos Sur Desarme" id 2, "Desarmaduría Norte
// Autopartes" id 3) ni nada que dependa solo de ellos (sus usuarios, su
// inventario/ventas, y la conversación de chat entre negocios 1 y 2, ya que
// el negocio 2 no se migra). Si en el futuro se decide migrarlos también,
// basta con agregar sus ids a NEGOCIOS_A_MIGRAR.
//
// Lo que SÍ se migra, por negocio: negocio, usuarios (con su password_hash y
// salt tal cual — se puede seguir ingresando con la misma contraseña),
// vehículos, inventario (con sus fotos, si las tuviera, subidas a Cloud
// Storage), catálogo de repuestos, repisas, compras de bodega +
// inventario_bodega, ventas (con sus ítems embebidos), órdenes de taller
// (sin fotos — ver DISEÑO-FIRESTORE.md) y la bitácora de auditoría completa.
// También se copia la clave de cifrado de config_app, para que las
// contraseñas "vistas" (password_plana) sigan descifrando igual.
//
// Lo que NO se migra a propósito: las sesiones activas (son tokens de login
// efímeros — no tiene sentido migrarlos, cada usuario inicia sesión de
// nuevo) y taller_fotos (la versión Firebase no tiene fotos en el taller).
const { DatabaseSync } = require('node:sqlite');
const { crearNegociosDb } = require('../db/negocios');
const { crearUsuariosDb } = require('../db/usuarios');
const { crearVehiculosDb } = require('../db/vehiculos');
const { crearInventarioDb } = require('../db/inventario');
const { crearCatalogoDb } = require('../db/catalogo');
const { crearBodegaDb } = require('../db/bodega');
const { crearRepisasDb } = require('../db/repisas');
const { crearVentasDb } = require('../db/ventas');
const { crearTallerDb } = require('../db/taller');
const { crearChatDb } = require('../db/chat');

const NEGOCIOS_A_MIGRAR = [1];

function abrirSqlite(ruta) {
  const conexion = new DatabaseSync(ruta, { readOnly: true });
  return {
    todos(sql, ...params) {
      return conexion.prepare(sql).all(...params);
    },
    uno(sql, ...params) {
      return conexion.prepare(sql).get(...params);
    },
    cerrar() {
      conexion.close();
    },
  };
}

async function migrar({ rutaSqlite, db, negociosAMigrar = NEGOCIOS_A_MIGRAR, forzar = false, log = () => {} }) {
  const sqlite = abrirSqlite(rutaSqlite);
  try {
    const negociosDb = crearNegociosDb(db);
    const usuariosDb = crearUsuariosDb(db);
    const vehiculosDb = crearVehiculosDb(db);
    const inventarioDb = crearInventarioDb(db);
    const catalogoDb = crearCatalogoDb(db);
    const bodegaDb = crearBodegaDb(db);
    const repisasDb = crearRepisasDb(db, bodegaDb);
    const ventasDb = crearVentasDb(db);
    const tallerDb = crearTallerDb(db);
    const chatDb = crearChatDb(db);

    const resumen = {
      negocios: 0,
      usuarios: 0,
      vehiculos: 0,
      inventario: 0,
      catalogo_repuestos: 0,
      repisas: 0,
      compras_bodega: 0,
      inventario_bodega: 0,
      ventas: 0,
      taller_ordenes: 0,
      auditoria: 0,
      chats: 0,
      mensajes_chat: 0,
    };

    // ---- Resguardo: no volver a correr esto por accidente ----
    // (algunas colecciones usan ids autogenerados — ventas, auditoría,
    // catálogo, piezas de bodega, mensajes — y correr la migración dos
    // veces las duplicaría. Las que usan id = numero/username se
    // sobrescribirían sin duplicar, pero igual es más seguro frenar todo.)
    for (const negocioId of negociosAMigrar) {
      const yaExiste = await negociosDb.obtenerPorId(negocioId);
      if (yaExiste && !forzar) {
        throw new Error(`El negocio ${negocioId} ("${yaExiste.nombre}") ya existe en el destino. Si de verdad quieres volver a migrar (puede duplicar ventas/auditoría/mensajes), pasa forzar: true.`);
      }
    }

    // ---- negocios ----
    for (const negocioId of negociosAMigrar) {
      const n = sqlite.uno('SELECT * FROM negocios WHERE id = ?', negocioId);
      if (!n) throw new Error(`No existe el negocio ${negocioId} en el origen`);
      await negociosDb.crear(String(n.id), {
        nombre: n.nombre,
        rut: n.rut,
        telefono_dueno: n.telefono_dueno,
        email_contacto: n.email_contacto,
        direccion: n.direccion,
        plan: n.plan,
        activo: n.activo,
        creado_en: n.creado_en,
      });
      resumen.negocios++;
      log(`Negocio migrado: ${n.nombre}`);
    }

    // ---- config_app: clave de cifrado de password_plana ----
    // Se copia tal cual (en vez de dejar que usuariosDb.obtenerClaveCifrado()
    // genere una nueva) para que las contraseñas ya cifradas con la clave
    // vieja sigan descifrando bien del lado del admin que las "ve".
    const configCifrado = sqlite.uno("SELECT valor FROM config_app WHERE clave = 'clave_cifrado_pass'");
    if (configCifrado) {
      await db.collection('config_app').doc('clave_cifrado_pass').set({ valor: configCifrado.valor });
      log('Clave de cifrado de contraseñas copiada.');
    }

    // ---- usuarios ---- (mapa usuario_id de SQL -> username, para auditoría/ventas/chat)
    const usernamePorUsuarioId = new Map();
    for (const negocioId of negociosAMigrar) {
      const usuarios = sqlite.todos('SELECT * FROM usuarios WHERE negocio_id = ?', negocioId);
      for (const u of usuarios) {
        await usuariosDb.crear(u.usuario, {
          negocio_id: String(u.negocio_id),
          nombre: u.nombre,
          password_hash: u.password_hash,
          salt: u.salt,
          rol: u.rol,
          activo: u.activo,
          debe_cambiar_password: u.debe_cambiar_password,
          password_plana: u.password_plana,
          intentos_ver_password: u.intentos_ver_password,
          bloqueado_ver_password: u.bloqueado_ver_password,
          creado_en: u.creado_en,
        });
        usernamePorUsuarioId.set(u.id, u.usuario);
        resumen.usuarios++;
      }
      log(`${usuarios.length} usuario(s) migrados del negocio ${negocioId}.`);
    }

    // ---- vehículos ---- (mapa id de SQL -> numero, para ligar inventario)
    const vehiculoNumeroPorSqlId = new Map();
    for (const negocioId of negociosAMigrar) {
      const vehiculos = sqlite.todos('SELECT * FROM vehiculos WHERE negocio_id = ?', negocioId);
      for (const v of vehiculos) {
        await vehiculosDb.crear(String(negocioId), v.numero, {
          patente: v.patente,
          marca: v.marca,
          modelo: v.modelo,
          anio: v.anio,
          color: v.color,
          kilometraje: v.kilometraje,
          estado: v.estado,
          origen: v.origen,
          observaciones: v.observaciones,
          costo_compra: v.costo_compra,
          valor_motor_referencia: v.valor_motor_referencia,
          fecha_ingreso: v.fecha_ingreso,
        });
        vehiculoNumeroPorSqlId.set(v.id, String(v.numero));
        resumen.vehiculos++;
      }
      log(`${vehiculos.length} vehículo(s) migrados del negocio ${negocioId}.`);
    }

    // ---- inventario ---- (mapa id de SQL -> nuevo id de Firestore, para venta_items)
    const inventarioIdPorSqlId = new Map();
    for (const negocioId of negociosAMigrar) {
      const items = sqlite.todos('SELECT * FROM inventario WHERE negocio_id = ?', negocioId);
      for (const it of items) {
        const nuevoId = await inventarioDb.crear(String(negocioId), {
          vehiculo_id: it.vehiculo_id ? vehiculoNumeroPorSqlId.get(it.vehiculo_id) || null : null,
          codigo: it.codigo,
          nombre: it.nombre,
          categoria: it.categoria,
          cantidad_disponible: it.cantidad_disponible,
          cantidad_minima: it.cantidad_minima,
          precio_venta: it.precio_venta,
          costo_unitario: it.costo_unitario,
          ubicacion: it.ubicacion,
          fecha_ingreso: it.fecha_ingreso,
          activo: it.activo,
        });
        // Por decisión del usuario, el inventario no lleva fotos en la
        // versión nueva (ver DISEÑO-FIRESTORE.md) — las fotos que pueda
        // tener el sistema viejo en SQLite no se migran.
        inventarioIdPorSqlId.set(it.id, nuevoId);
        resumen.inventario++;
      }
      log(`${items.length} repuesto(s) de inventario migrados del negocio ${negocioId}.`);
    }

    // ---- catálogo de repuestos ----
    for (const negocioId of negociosAMigrar) {
      const filas = sqlite.todos('SELECT * FROM catalogo_repuestos WHERE negocio_id = ?', negocioId);
      for (const f of filas) {
        await catalogoDb.crear(String(negocioId), { categoria: f.categoria, nombre: f.nombre, oculto: f.oculto, creado_en: f.creado_en });
        resumen.catalogo_repuestos++;
      }
      log(`${filas.length} entrada(s) de catálogo migradas del negocio ${negocioId}.`);
    }

    // ---- repisas ---- (mapa id de SQL -> nuevo id de Firestore, para inventario_bodega)
    const repisaIdPorSqlId = new Map();
    for (const negocioId of negociosAMigrar) {
      const filas = sqlite.todos('SELECT * FROM repisas WHERE negocio_id = ?', negocioId);
      for (const r of filas) {
        const nuevoId = await repisasDb.crear(String(negocioId), { nombre: r.nombre, cantidad_filas: r.cantidad_filas, creado_en: r.creado_en });
        repisaIdPorSqlId.set(r.id, nuevoId);
        resumen.repisas++;
      }
      log(`${filas.length} repisa(s) migradas del negocio ${negocioId}.`);
    }

    // ---- compras_bodega ---- (mapa id de SQL -> numero + nombre, para inventario_bodega y venta_items)
    const compraNumeroPorSqlId = new Map();
    const compraNombrePorSqlId = new Map();
    for (const negocioId of negociosAMigrar) {
      const compras = sqlite.todos('SELECT * FROM compras_bodega WHERE negocio_id = ?', negocioId);
      for (const c of compras) {
        await bodegaDb.crearCompra(String(negocioId), c.numero, {
          nombre: c.nombre,
          proveedor: c.proveedor,
          costo_total: c.costo_total,
          observaciones: c.observaciones,
          fecha_ingreso: c.fecha_ingreso,
        });
        compraNumeroPorSqlId.set(c.id, String(c.numero));
        compraNombrePorSqlId.set(c.id, c.nombre);
        resumen.compras_bodega++;
      }
      log(`${compras.length} compra(s) de bodega migradas del negocio ${negocioId}.`);
    }

    // ---- inventario_bodega ---- (mapa id de SQL -> {nuevoId, bodega_numero, bodega_compra_nombre}, para venta_items)
    const bodegaPorSqlId = new Map();
    for (const negocioId of negociosAMigrar) {
      const piezas = sqlite.todos('SELECT * FROM inventario_bodega WHERE negocio_id = ?', negocioId);
      for (const p of piezas) {
        const nuevoId = await bodegaDb.crearPieza(String(negocioId), {
          compra_id: p.compra_id ? compraNumeroPorSqlId.get(p.compra_id) || null : null,
          codigo: p.codigo,
          nombre: p.nombre,
          categoria: p.categoria,
          cantidad_disponible: p.cantidad_disponible,
          cantidad_minima: p.cantidad_minima,
          precio_venta: p.precio_venta,
          costo_unitario: p.costo_unitario,
          repisa_id: p.repisa_id ? repisaIdPorSqlId.get(p.repisa_id) || null : null,
          fila: p.fila,
          fecha_ingreso: p.fecha_ingreso,
          activo: p.activo,
        });
        bodegaPorSqlId.set(p.id, {
          nuevoId,
          bodega_numero: p.compra_id ? Number(compraNumeroPorSqlId.get(p.compra_id)) || null : null,
          bodega_compra_nombre: p.compra_id ? compraNombrePorSqlId.get(p.compra_id) || null : null,
        });
        resumen.inventario_bodega++;
      }
      log(`${piezas.length} pieza(s) de inventario bodega migradas del negocio ${negocioId}.`);
    }

    // ---- ventas + venta_items (embebidos en el documento de la venta) ----
    for (const negocioId of negociosAMigrar) {
      const ventas = sqlite.todos('SELECT * FROM ventas WHERE negocio_id = ?', negocioId);
      for (const v of ventas) {
        const itemsSql = sqlite.todos('SELECT * FROM venta_items WHERE venta_id = ?', v.id);
        const items = itemsSql.map((it) => {
          const item = {
            inventario_id: it.inventario_id ? inventarioIdPorSqlId.get(it.inventario_id) || null : null,
            inventario_bodega_id: null,
            origen: it.origen || 'vehiculo',
            nombre_repuesto: it.nombre_repuesto,
            categoria: it.categoria,
            cantidad: it.cantidad,
            precio_unitario: it.precio_unitario,
            bodega_numero: null,
            bodega_compra_nombre: null,
          };
          if (it.inventario_bodega_id) {
            const info = bodegaPorSqlId.get(it.inventario_bodega_id);
            item.inventario_bodega_id = info ? info.nuevoId : null;
            item.bodega_numero = info ? info.bodega_numero : null;
            item.bodega_compra_nombre = info ? info.bodega_compra_nombre : null;
          }
          return item;
        });
        // No se aplica ningún ajuste de stock acá (FieldValue.increment, como
        // hace POST /api/ventas): esto es historial de solo lectura, el
        // stock actual ya quedó bien reflejado al migrar "inventario" más
        // arriba (ya incluye el efecto acumulado de estas ventas).
        await ventasDb.crear(String(negocioId), {
          usuario: usernamePorUsuarioId.get(v.usuario_id) || null,
          fecha: v.fecha,
          total: v.total,
          tipo_pago: v.tipo_pago,
          cliente_nombre: v.cliente_nombre,
          cliente_telefono: v.cliente_telefono,
          estado: v.estado,
          notificacion_whatsapp_estado: v.notificacion_whatsapp_estado,
          items,
        });
        resumen.ventas++;
      }
      log(`${ventas.length} venta(s) migradas del negocio ${negocioId}.`);
    }

    // ---- órdenes de taller mecánico (sin fotos — taller_fotos no se migra) ----
    for (const negocioId of negociosAMigrar) {
      const ordenes = sqlite.todos('SELECT * FROM taller_ordenes WHERE negocio_id = ?', negocioId);
      for (const o of ordenes) {
        await tallerDb.crear(String(negocioId), o.numero, {
          dueno_nombre: o.dueno_nombre,
          dueno_telefono: o.dueno_telefono,
          dueno_rut: o.dueno_rut,
          vehiculo_patente: o.vehiculo_patente,
          vehiculo_marca: o.vehiculo_marca,
          vehiculo_modelo: o.vehiculo_modelo,
          vehiculo_anio: o.vehiculo_anio,
          vehiculo_color: o.vehiculo_color,
          comentario_ingreso: o.comentario_ingreso,
          presupuesto_monto: o.presupuesto_monto,
          presupuesto_notas: o.presupuesto_notas,
          trabajos_realizados: o.trabajos_realizados,
          cobro_final: o.cobro_final,
          estado: o.estado,
          fecha_ingreso: o.fecha_ingreso,
          fecha_entrega: o.fecha_entrega,
        });
        resumen.taller_ordenes++;
      }
      log(`${ordenes.length} orden(es) de taller migradas del negocio ${negocioId} (sin fotos).`);
    }

    // ---- bitácora de auditoría ----
    // Se escribe directo con db.collection(...) en vez de auditoriaDb.registrar()
    // porque registrar() siempre pone fecha = ahora(): acá se necesita
    // conservar la fecha real de cada hecho histórico.
    for (const negocioId of negociosAMigrar) {
      const filas = sqlite.todos('SELECT * FROM auditoria WHERE negocio_id = ? ORDER BY id', negocioId);
      for (const a of filas) {
        await db
          .collection('negocios')
          .doc(String(negocioId))
          .collection('auditoria')
          .add({
            usuario: a.usuario_id ? usernamePorUsuarioId.get(a.usuario_id) || null : null,
            usuario_nombre: a.usuario_nombre,
            rol: a.rol,
            accion: a.accion,
            entidad_tipo: a.entidad_tipo,
            entidad_id: a.entidad_id,
            detalle: a.detalle,
            fecha: a.fecha,
          });
        resumen.auditoria++;
      }
      log(`${filas.length} registro(s) de auditoría migrados del negocio ${negocioId}.`);
    }

    // ---- chat entre negocios ----
    // Solo se migra una conversación si AMBOS negocios involucrados están en
    // negociosAMigrar — si el otro lado no se migró, no tiene sentido
    // conservarla (quedaría hablándole a un negocio que no existe).
    const conversaciones = sqlite.todos('SELECT * FROM chat_conversaciones');
    for (const c of conversaciones) {
      if (!negociosAMigrar.includes(c.negocio_a_id) || !negociosAMigrar.includes(c.negocio_b_id)) continue;
      const id = chatDb.idDe(c.negocio_a_id, c.negocio_b_id);
      const [a, b] = [String(c.negocio_a_id), String(c.negocio_b_id)].sort();
      await db
        .collection('chats')
        .doc(id)
        .set({ negocio_a_id: a, negocio_b_id: b, creado_en: c.creado_en, ultimo_mensaje_en: c.ultimo_mensaje_en || c.creado_en });
      resumen.chats++;

      const mensajes = sqlite.todos('SELECT * FROM chat_mensajes WHERE conversacion_id = ? ORDER BY id', c.id);
      for (const m of mensajes) {
        await db
          .collection('chats')
          .doc(id)
          .collection('mensajes')
          .add({
            negocio_emisor_id: String(m.negocio_emisor_id),
            usuario: m.usuario_id ? usernamePorUsuarioId.get(m.usuario_id) || null : null,
            mensaje: m.mensaje,
            enviado_en: m.enviado_en,
            leido: !!m.leido,
          });
        resumen.mensajes_chat++;
      }
    }
    if (conversaciones.length) log(`${resumen.chats} conversación(es) de chat y ${resumen.mensajes_chat} mensaje(s) migrados.`);

    return resumen;
  } finally {
    sqlite.cerrar();
  }
}

module.exports = { migrar, NEGOCIOS_A_MIGRAR };
