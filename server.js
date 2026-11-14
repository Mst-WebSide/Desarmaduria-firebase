// Servidor del ERP de desarmadurías — versión Firestore (Firebase).
//
// Mismo router casero y mismas rutas que el server.js original (SQL), para
// que el frontend no necesite cambios. Lo único que cambia por debajo es el
// acceso a datos: en vez de "db.prepare(sql).get/all/run(...)" se usan los
// módulos de db/*.js (negocios, usuarios, ...), que hablan con Firestore.
//
// AVANCE DE LA MIGRACIÓN (ver tareas en la conversación):
//   [x] AUTH + USUARIOS + NEGOCIO
//   [x] VEHÍCULOS + INVENTARIO (desarme)
//   [x] BODEGA (compras_bodega, inventario_bodega, repisas, catálogo)
//   [x] VENTAS
//   [x] TALLER MECÁNICO (sin fotos — ver DISEÑO-FIRESTORE.md)
//   [x] MARKETPLACE / CHAT entre negocios
//   [x] AUDITORÍA (lectura/filtros), REPORTES/DASHBOARD, CARGA MASIVA EXCEL
//
// Todas las rutas de la API original ya están portadas y probadas contra el
// Firestore falso de pruebas (ver test-doubles/). Falta: migrar los datos
// reales, portar public/ (frontend, sin cambios porque la API es idéntica) y
// preparar el despliegue.
require('dotenv').config({ quiet: true });
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const auth = require('./auth'); // idéntico al original: hash/sal/cifrado no dependen de la base de datos
const notificaciones = require('./notificaciones'); // idéntico al original: no depende de la base de datos
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const { crearNegociosDb } = require('./db/negocios');
const { crearUsuariosDb } = require('./db/usuarios');
const { crearAuditoriaDb, ACCIONES: ACCIONES_AUDITORIA } = require('./db/auditoria');
const { crearVehiculosDb } = require('./db/vehiculos');
const { crearInventarioDb } = require('./db/inventario');
const { crearCatalogoDb } = require('./db/catalogo');
const { crearBodegaDb } = require('./db/bodega');
const { crearRepisasDb } = require('./db/repisas');
const { crearVentasDb } = require('./db/ventas');
const { crearTallerDb } = require('./db/taller');
const { crearMarketplaceDb } = require('./db/marketplace');
const { crearChatDb } = require('./db/chat');

const fmtCLPServidor = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 });
const PUERTO = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

function ahora() {
  return new Date().toISOString();
}

let db; // instancia de Firestore (real o la falsa de pruebas) — se inyecta en iniciar()
let negociosDb, usuariosDb, auditoriaDb, vehiculosDb, inventarioDb, catalogoDb, bodegaDb, repisasDb, ventasDb, tallerDb, marketplaceDb, chatDb;
let claveCifradoPass;
let FieldValue; // inyectado en iniciar() — admin.firestore.FieldValue en producción, o el de fake-firestore.js en pruebas

function totalVenta(items) {
  return items.reduce((acc, it) => acc + it.cantidad * it.precio_unitario, 0);
}

const TIPOS_PAGO = ['efectivo', 'tarjeta_debito', 'tarjeta_credito', 'transferencia', 'otro'];

function registrarAuditoria(usuario, datos) {
  return auditoriaDb.registrar({ negocio_id: usuario.negocio_id, usuario, ...datos });
}

// ==================== Utilidades HTTP (idéntico al original) ====================

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function sendJson(res, status, data) {
  const cuerpo = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(cuerpo);
}

function sendError(res, status, mensaje) {
  sendJson(res, status, { error: mensaje });
}

// Exportaciones a CSV (para Excel) del historial de ventas y de la bitácora
// de auditoría — idéntico al original: mismo formato de filas que la vista
// JSON, para que lo que se ve en pantalla sea exactamente lo que se descarga.
function celdaCsv(valor) {
  if (valor === null || valor === undefined) return '';
  const texto = String(valor);
  if (/[",\n;]/.test(texto)) return `"${texto.replace(/"/g, '""')}"`;
  return texto;
}

function aCsv(filas, columnas) {
  const encabezado = columnas.map((c) => celdaCsv(c.titulo)).join(',');
  const lineas = filas.map((fila) => columnas.map((c) => celdaCsv(c.valor(fila))).join(','));
  return '﻿' + [encabezado, ...lineas].join('\r\n'); // BOM para que Excel abra bien los acentos
}

function sendCsv(res, nombreArchivo, contenido) {
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${nombreArchivo}"`,
  });
  res.end(contenido);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let datos = '';
    req.on('data', (chunk) => {
      datos += chunk;
      if (datos.length > 15 * 1024 * 1024) req.destroy();
    });
    req.on('end', () => {
      if (!datos) return resolve({});
      try {
        resolve(JSON.parse(datos));
      } catch (e) {
        reject(new Error('JSON inválido'));
      }
    });
    req.on('error', reject);
  });
}

// ==================== Router (idéntico al original) ====================

const rutas = [];

function route(metodo, patron, handler, opts = {}) {
  const segmentos = patron.split('/').filter(Boolean);
  rutas.push({ metodo, segmentos, handler, opts });
}

function emparejar(segmentosPatron, segmentosPath) {
  if (segmentosPatron.length !== segmentosPath.length) return null;
  const params = {};
  for (let i = 0; i < segmentosPatron.length; i++) {
    const p = segmentosPatron[i];
    if (p.startsWith(':')) {
      params[p.slice(1)] = decodeURIComponent(segmentosPath[i]);
    } else if (p !== segmentosPath[i]) {
      return null;
    }
  }
  return params;
}

// ==================== Sesión / autenticación ====================
// Antes era un JOIN usuarios+negocios en una sola consulta SQL; en Firestore
// son dos lecturas por documento (no hay JOIN), pero el resultado que recibe
// el resto del código es exactamente el mismo objeto "usuario".

async function obtenerUsuarioDeSesion(req) {
  const token = auth.leerCookie(req, 'sesion');
  if (!token) return null;
  const sesion = await usuariosDb.obtenerSesion(token);
  if (!sesion) return null;
  if (new Date(sesion.expira_en).getTime() < Date.now()) {
    await usuariosDb.borrarSesion(token);
    return null;
  }
  const fila = await usuariosDb.obtenerPorUsername(sesion.usuario);
  if (!fila || !fila.activo) return null;
  const negocio = await negociosDb.obtenerPorId(fila.negocio_id);
  return {
    id: fila.id,
    nombre: fila.nombre,
    usuario: fila.usuario,
    rol: fila.rol,
    activo: fila.activo,
    debe_cambiar_password: fila.debe_cambiar_password,
    negocio_id: fila.negocio_id,
    bloqueado_ver_password: fila.bloqueado_ver_password,
    negocio_nombre: negocio ? negocio.nombre : null,
    telefono_dueno: negocio ? negocio.telefono_dueno : null,
    email_contacto: negocio ? negocio.email_contacto : null,
    direccion: negocio ? negocio.direccion : null,
    rut: negocio ? negocio.rut : null,
  };
}

// ==================== Páginas estáticas (idéntico al original) ====================

const PAGINAS_PUBLICAS = new Set(['/login.html', '/css/style.css', '/js/login.js', '/js/common.js', '/favicon.ico']);

function extensionValida(pathname) {
  return Object.keys(MIME).includes(path.extname(pathname));
}

async function servirEstatico(req, res, usuario, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  const rutaArchivo = path.join(PUBLIC_DIR, rel);
  if (!rutaArchivo.startsWith(PUBLIC_DIR)) return sendError(res, 400, 'Ruta inválida');

  const esHtml = path.extname(rel) === '.html' || rel === '/';
  const esPublica = PAGINAS_PUBLICAS.has(rel);

  if (esHtml && !esPublica && !usuario) {
    res.writeHead(302, { Location: '/login.html' });
    return res.end();
  }
  if (rel === '/login.html' && usuario) {
    res.writeHead(302, { Location: '/index.html' });
    return res.end();
  }

  fs.readFile(rutaArchivo, (err, contenido) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('No encontrado');
    }
    const ext = path.extname(rutaArchivo);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(contenido);
  });
}

// ==================== Helpers de negocio (idéntico al original) ====================

const ROLES = ['admin', 'mecanico_lider', 'mecanico', 'vendedor'];
const ROL_LABEL_AUDITORIA = { admin: 'Administrador', mecanico_lider: 'Mecánico líder', mecanico: 'Mecánico', vendedor: 'Vendedor' };
const CATEGORIAS_REPUESTO = ['Motor', 'Tren delantero', 'Tren trasero', 'Transmisión', 'Cardán delantero', 'Cardán trasero', 'Frenos', 'Eléctrico', 'Carrocería', 'Interior', 'Neumáticos', 'Otro'];

function etiquetaVehiculo(v) {
  return v.patente || `N°${v.numero}`;
}

function etiquetaOrdenTaller(o) {
  return `N°${o.numero}${o.vehiculo_patente ? ` — ${o.vehiculo_patente}` : ''} (${o.dueno_nombre})`;
}

const CLAVE_MAESTRA_DESBLOQUEO = process.env.CLAVE_MAESTRA_DESBLOQUEO || null;
const INTENTOS_MAX_VER_PASSWORD = 3;

// ==================== AUTH ====================

route(
  'POST',
  '/api/auth/login',
  async (req, res) => {
    const body = await readBody(req);
    if (!body.usuario || !body.password) return sendError(res, 400, 'Falta usuario o contraseña');
    const fila = await usuariosDb.obtenerPorUsername(body.usuario.trim());
    if (!fila || !fila.activo) return sendError(res, 401, 'Usuario o contraseña incorrectos');
    if (!auth.verificarPassword(body.password, fila.salt, fila.password_hash)) {
      return sendError(res, 401, 'Usuario o contraseña incorrectos');
    }
    const token = auth.generarToken();
    const expira = new Date(Date.now() + auth.DURACION_SESION_MS).toISOString();
    await usuariosDb.crearSesion(token, { usuario: fila.usuario, creado_en: ahora(), expira_en: expira });
    auth.fijarCookieSesion(res, token);
    sendJson(res, 200, { id: fila.id, nombre: fila.nombre, rol: fila.rol, debe_cambiar_password: !!fila.debe_cambiar_password });
  },
  { publico: true }
);

route('POST', '/api/auth/logout', async (req, res) => {
  const token = auth.leerCookie(req, 'sesion');
  if (token) await usuariosDb.borrarSesion(token);
  auth.borrarCookieSesion(res);
  sendJson(res, 200, { ok: true });
});

route('GET', '/api/auth/me', async (req, res, params, query, usuario) => {
  sendJson(res, 200, {
    id: usuario.id,
    nombre: usuario.nombre,
    usuario: usuario.usuario,
    rol: usuario.rol,
    debe_cambiar_password: !!usuario.debe_cambiar_password,
    bloqueado_ver_password: !!usuario.bloqueado_ver_password,
    negocio: {
      id: usuario.negocio_id,
      nombre: usuario.negocio_nombre,
      telefono_dueno: usuario.telefono_dueno,
      email_contacto: usuario.email_contacto,
      direccion: usuario.direccion,
      rut: usuario.rut,
    },
  });
});

route('POST', '/api/auth/cambiar-password', async (req, res, params, query, usuario) => {
  const body = await readBody(req);
  if (!body.passwordActual || !body.passwordNueva) return sendError(res, 400, 'Faltan datos');
  const fila = await usuariosDb.obtenerPorUsername(usuario.usuario);
  if (!auth.verificarPassword(body.passwordActual, fila.salt, fila.password_hash)) {
    return sendError(res, 400, 'La contraseña actual no es correcta');
  }
  if (body.passwordNueva.length < 6) return sendError(res, 400, 'La contraseña nueva debe tener al menos 6 caracteres');
  const { hash, salt } = auth.hashPassword(body.passwordNueva);
  const passwordPlana = auth.cifrarTexto(body.passwordNueva, claveCifradoPass);
  await usuariosDb.actualizar(usuario.usuario, {
    password_hash: hash,
    salt,
    password_plana: passwordPlana,
    debe_cambiar_password: 0,
  });
  sendJson(res, 200, { ok: true });
});

// ==================== USUARIOS (solo admin, dentro del propio negocio) ====================

function vistaUsuarioLista(u) {
  // Mismas columnas que el SELECT original — nunca se manda password_hash,
  // salt ni password_plana al frontend desde este endpoint.
  return { id: u.id, nombre: u.nombre, usuario: u.usuario, rol: u.rol, activo: u.activo, debe_cambiar_password: u.debe_cambiar_password, creado_en: u.creado_en };
}

route(
  'GET',
  '/api/usuarios',
  async (req, res, params, query, usuario) => {
    const data = await usuariosDb.listarPorNegocio(usuario.negocio_id);
    sendJson(res, 200, data.map(vistaUsuarioLista));
  },
  { roles: ['admin'] }
);

route(
  'POST',
  '/api/usuarios',
  async (req, res, params, query, usuario) => {
    const body = await readBody(req);
    if (!body.nombre || !body.nombre.trim()) return sendError(res, 400, 'Falta el nombre');
    if (!ROLES.includes(body.rol)) return sendError(res, 400, `Rol inválido. Debe ser una de: ${ROLES.join(', ')}`);

    let nombreUsuario = auth.normalizarUsuario(body.nombre);
    let sufijo = 1;
    const base = nombreUsuario;
    while (!(await usuariosDb.nombreDeUsuarioDisponible(nombreUsuario))) {
      sufijo += 1;
      nombreUsuario = base + sufijo;
    }
    let passwordTemporal = null;
    let passwordElegidaPorAdmin = false;
    if (body.password !== undefined && body.password !== null && String(body.password).trim() !== '') {
      const passwordTexto = String(body.password);
      if (passwordTexto.length < 6) return sendError(res, 400, 'La contraseña debe tener al menos 6 caracteres');
      passwordTemporal = passwordTexto;
      passwordElegidaPorAdmin = true;
    } else {
      passwordTemporal = Math.random().toString(36).slice(-8);
    }
    const { hash, salt } = auth.hashPassword(passwordTemporal);
    const passwordPlana = auth.cifrarTexto(passwordTemporal, claveCifradoPass);
    await usuariosDb.crear(nombreUsuario, {
      negocio_id: usuario.negocio_id,
      nombre: body.nombre.trim(),
      password_hash: hash,
      salt,
      rol: body.rol,
      password_plana: passwordPlana,
      debe_cambiar_password: passwordElegidaPorAdmin ? 0 : 1,
      intentos_ver_password: 0,
      bloqueado_ver_password: 0,
      activo: 1,
      creado_en: ahora(),
    });
    await registrarAuditoria(usuario, {
      accion: 'usuario_creado',
      entidad_tipo: 'usuario',
      entidad_id: nombreUsuario,
      detalle: `Creó al usuario "${body.nombre.trim()}" (${nombreUsuario}) con rol ${ROL_LABEL_AUDITORIA[body.rol] || body.rol}.`,
    });
    sendJson(res, 201, { id: nombreUsuario, usuario: nombreUsuario, passwordTemporal });
  },
  { roles: ['admin'] }
);

route(
  'PATCH',
  '/api/usuarios/:id',
  async (req, res, params, query, usuario) => {
    const body = await readBody(req);
    const objetivo = await usuariosDb.obtenerPorUsername(params.id);
    if (!objetivo || objetivo.negocio_id !== usuario.negocio_id) return sendError(res, 404, 'Usuario no encontrado');

    const cambiosDb = {};
    const cambios = [];
    if (body.rol !== undefined) {
      if (!ROLES.includes(body.rol)) return sendError(res, 400, 'Rol inválido');
      cambiosDb.rol = body.rol;
      if (body.rol !== objetivo.rol) cambios.push(`rol: ${ROL_LABEL_AUDITORIA[objetivo.rol] || objetivo.rol} → ${ROL_LABEL_AUDITORIA[body.rol] || body.rol}`);
    }
    if (body.activo !== undefined) {
      const nuevoActivo = body.activo ? 1 : 0;
      cambiosDb.activo = nuevoActivo;
      if (nuevoActivo !== objetivo.activo) cambios.push(nuevoActivo ? 'reactivado' : 'desactivado');
    }
    let passwordTemporal = null;
    if (body.passwordNueva !== undefined && body.passwordNueva !== null && String(body.passwordNueva).trim() !== '') {
      const passwordTexto = String(body.passwordNueva);
      if (passwordTexto.length < 6) return sendError(res, 400, 'La contraseña debe tener al menos 6 caracteres');
      passwordTemporal = passwordTexto;
      const { hash, salt } = auth.hashPassword(passwordTemporal);
      Object.assign(cambiosDb, { password_hash: hash, salt, password_plana: auth.cifrarTexto(passwordTemporal, claveCifradoPass), debe_cambiar_password: 0 });
      cambios.push('contraseña cambiada por el administrador');
    } else if (body.resetPassword) {
      passwordTemporal = Math.random().toString(36).slice(-8);
      const { hash, salt } = auth.hashPassword(passwordTemporal);
      Object.assign(cambiosDb, { password_hash: hash, salt, password_plana: auth.cifrarTexto(passwordTemporal, claveCifradoPass), debe_cambiar_password: 1 });
      cambios.push('contraseña restablecida');
    }
    if (!Object.keys(cambiosDb).length) return sendError(res, 400, 'Nada para actualizar');
    await usuariosDb.actualizar(params.id, cambiosDb);
    if (cambios.length) {
      await registrarAuditoria(usuario, {
        accion: 'usuario_editado',
        entidad_tipo: 'usuario',
        entidad_id: params.id,
        detalle: `Modificó a "${objetivo.nombre}" (${objetivo.usuario}): ${cambios.join('; ')}.`,
      });
    }
    sendJson(res, 200, { ok: true, passwordTemporal });
  },
  { roles: ['admin'] }
);

route(
  'POST',
  '/api/usuarios/:id/ver-password',
  async (req, res, params, query, usuario) => {
    const body = await readBody(req);
    const quienMira = await usuariosDb.obtenerPorUsername(usuario.usuario);
    if (quienMira.bloqueado_ver_password) {
      return sendError(res, 423, 'Bloqueaste esta función por 3 intentos fallidos. Necesitas la clave maestra para desbloquearla.');
    }
    if (!body.passwordAdmin) return sendError(res, 400, 'Falta tu contraseña');
    if (!auth.verificarPassword(body.passwordAdmin, quienMira.salt, quienMira.password_hash)) {
      const intentos = (quienMira.intentos_ver_password || 0) + 1;
      if (intentos >= INTENTOS_MAX_VER_PASSWORD) {
        await usuariosDb.actualizar(usuario.usuario, { intentos_ver_password: intentos, bloqueado_ver_password: 1 });
        return sendError(res, 423, 'Contraseña incorrecta. Se bloqueó esta función por 3 intentos fallidos — necesitas la clave maestra para desbloquearla.');
      }
      await usuariosDb.actualizar(usuario.usuario, { intentos_ver_password: intentos });
      return sendError(res, 401, `Tu contraseña no es correcta (te quedan ${INTENTOS_MAX_VER_PASSWORD - intentos} intento(s)).`);
    }
    await usuariosDb.actualizar(usuario.usuario, { intentos_ver_password: 0 });

    const objetivo = await usuariosDb.obtenerPorUsername(params.id);
    if (!objetivo || objetivo.negocio_id !== usuario.negocio_id) return sendError(res, 404, 'Usuario no encontrado');
    const passwordVisible = auth.descifrarTexto(objetivo.password_plana, claveCifradoPass);
    if (!passwordVisible) {
      return sendError(res, 404, 'No hay una contraseña guardada de forma visible para este usuario (se guardó antes de que existiera esta función, o el usuario la cambió desde otra instalación). Puedes asignarle una nueva.');
    }
    await registrarAuditoria(usuario, {
      accion: 'password_visto',
      entidad_tipo: 'usuario',
      entidad_id: params.id,
      detalle: `Vio la contraseña de "${objetivo.nombre}" (${objetivo.usuario}).`,
    });
    sendJson(res, 200, { password: passwordVisible });
  },
  { roles: ['admin'] }
);

route(
  'POST',
  '/api/usuarios/desbloquear-ver-password',
  async (req, res, params, query, usuario) => {
    if (!CLAVE_MAESTRA_DESBLOQUEO) {
      return sendError(res, 500, 'No hay una clave maestra configurada en este servidor. Contacta a quien te instaló el sistema.');
    }
    const body = await readBody(req);
    if (!body.claveMaestra) return sendError(res, 400, 'Falta la clave maestra');
    if (body.claveMaestra !== CLAVE_MAESTRA_DESBLOQUEO) {
      return sendError(res, 401, 'Clave maestra incorrecta');
    }
    await usuariosDb.actualizar(usuario.usuario, { intentos_ver_password: 0, bloqueado_ver_password: 0 });
    await registrarAuditoria(usuario, {
      accion: 'password_desbloqueado',
      entidad_tipo: 'usuario',
      entidad_id: usuario.id,
      detalle: `Desbloqueó con la clave maestra la función de "ver contraseña" para su propia cuenta (${usuario.usuario}).`,
    });
    sendJson(res, 200, { ok: true });
  },
  { roles: ['admin'] }
);

// ==================== NEGOCIO (config propia) ====================

route(
  'PATCH',
  '/api/negocio',
  async (req, res, params, query, usuario) => {
    const body = await readBody(req);
    const cambiosDb = {};
    if (body.nombre !== undefined) {
      if (!body.nombre.trim()) return sendError(res, 400, 'El nombre del negocio no puede quedar vacío');
      cambiosDb.nombre = body.nombre.trim();
    }
    for (const campo of ['telefono_dueno', 'email_contacto', 'direccion', 'rut']) {
      if (body[campo] !== undefined) cambiosDb[campo] = body[campo] || null;
    }
    if (!Object.keys(cambiosDb).length) return sendError(res, 400, 'Nada para actualizar');
    await negociosDb.actualizar(usuario.negocio_id, cambiosDb);
    const negocio = await negociosDb.obtenerPorId(usuario.negocio_id);
    await registrarAuditoria(usuario, {
      accion: 'negocio_actualizado',
      entidad_tipo: 'negocio',
      entidad_id: usuario.negocio_id,
      detalle: `Actualizó los datos de contacto del negocio (${Object.keys(body).filter((k) => body[k] !== undefined).join(', ')}).`,
    });
    sendJson(res, 200, negocio);
  },
  { roles: ['admin'] }
);

// ==================== VEHÍCULOS ====================

route(
  'GET',
  '/api/vehiculos',
  async (req, res, params, query, usuario) => {
    const data = await vehiculosDb.listarPorNegocio(usuario.negocio_id);
    sendJson(res, 200, data);
  },
  { roles: ['admin', 'mecanico_lider'] }
);

route(
  'GET',
  '/api/vehiculos/:id',
  async (req, res, params, query, usuario) => {
    const vehiculo = await vehiculosDb.obtener(usuario.negocio_id, params.id);
    if (!vehiculo) return sendError(res, 404, 'Vehículo no encontrado');
    vehiculo.repuestos = await inventarioDb.listarPorVehiculo(usuario.negocio_id, params.id);
    sendJson(res, 200, vehiculo);
  },
  { roles: ['admin', 'mecanico_lider'] }
);

route(
  'POST',
  '/api/vehiculos',
  async (req, res, params, query, usuario) => {
    const body = await readBody(req);
    const patente = body.patente && body.patente.trim() ? body.patente.trim().toUpperCase() : null;
    let numero;
    if (body.numero !== undefined && body.numero !== null && body.numero !== '') {
      numero = Number(body.numero);
      if (!Number.isInteger(numero) || numero <= 0) return sendError(res, 400, 'El número de vehículo debe ser un entero positivo');
      if (await vehiculosDb.existeNumero(usuario.negocio_id, numero)) {
        return sendError(res, 400, `Ya existe el Vehículo ${numero} en tu negocio — elige otro número.`);
      }
    } else {
      numero = await vehiculosDb.siguienteNumero(usuario.negocio_id);
    }
    const datos = {
      patente,
      marca: body.marca || null,
      modelo: body.modelo || null,
      anio: body.anio || null,
      color: body.color || null,
      kilometraje: body.kilometraje || null,
      estado: 'en_desarme',
      origen: body.origen || null,
      observaciones: body.observaciones || null,
      costo_compra: Number(body.costo_compra) || 0,
      valor_motor_referencia: Number(body.valor_motor_referencia) || 0,
      fecha_ingreso: ahora(),
    };
    await vehiculosDb.crear(usuario.negocio_id, numero, datos);
    const vehiculo = await vehiculosDb.obtener(usuario.negocio_id, numero);
    await registrarAuditoria(usuario, {
      accion: 'vehiculo_creado',
      entidad_tipo: 'vehiculo',
      entidad_id: vehiculo.id,
      detalle: `Ingresó el vehículo N°${vehiculo.numero}${vehiculo.patente ? ` — ${vehiculo.patente}` : ''} (${[vehiculo.marca, vehiculo.modelo, vehiculo.anio].filter(Boolean).join(' ')}).`,
    });
    sendJson(res, 201, vehiculo);
  },
  { roles: ['admin', 'mecanico_lider'] }
);

route(
  'PATCH',
  '/api/vehiculos/:id',
  async (req, res, params, query, usuario) => {
    const body = await readBody(req);
    const existe = await vehiculosDb.obtener(usuario.negocio_id, params.id);
    if (!existe) return sendError(res, 404, 'Vehículo no encontrado');
    const cambiosDb = {};
    const cambios = [];
    if (body.patente !== undefined) {
      const nuevaPatente = body.patente && body.patente.trim() ? body.patente.trim().toUpperCase() : null;
      cambiosDb.patente = nuevaPatente;
      if (nuevaPatente !== existe.patente) cambios.push(`patente: ${existe.patente || '(sin patente)'} → ${nuevaPatente || '(sin patente)'}`);
    }
    for (const campo of ['marca', 'modelo', 'anio', 'color', 'kilometraje', 'origen', 'observaciones']) {
      if (body[campo] !== undefined) cambiosDb[campo] = body[campo] || null;
    }
    for (const [campo, etiqueta] of [['costo_compra', 'costo de compra'], ['valor_motor_referencia', 'valor de referencia del motor']]) {
      if (body[campo] !== undefined) {
        const nuevo = Number(body[campo]) || 0;
        cambiosDb[campo] = nuevo;
        if (nuevo !== existe[campo]) cambios.push(`${etiqueta}: ${fmtCLPServidor.format(existe[campo] || 0)} → ${fmtCLPServidor.format(nuevo)}`);
      }
    }
    let cambioEstado = false;
    if (body.estado !== undefined) {
      if (!['en_desarme', 'desarmado'].includes(body.estado)) return sendError(res, 400, 'Estado inválido');
      cambiosDb.estado = body.estado;
      cambioEstado = body.estado !== existe.estado;
    }
    if (!Object.keys(cambiosDb).length) return sendError(res, 400, 'Nada para actualizar');
    await vehiculosDb.actualizar(usuario.negocio_id, params.id, cambiosDb);
    const vehiculo = await vehiculosDb.obtener(usuario.negocio_id, params.id);
    if (cambioEstado && body.estado === 'desarmado') {
      await registrarAuditoria(usuario, { accion: 'vehiculo_desarmado', entidad_tipo: 'vehiculo', entidad_id: vehiculo.id, detalle: `Marcó el vehículo ${etiquetaVehiculo(vehiculo)} como desarmado.` });
    } else if (cambioEstado) {
      await registrarAuditoria(usuario, { accion: 'vehiculo_editado', entidad_tipo: 'vehiculo', entidad_id: vehiculo.id, detalle: `Volvió a marcar el vehículo ${etiquetaVehiculo(vehiculo)} como "en desarme".` });
    } else {
      await registrarAuditoria(usuario, { accion: 'vehiculo_editado', entidad_tipo: 'vehiculo', entidad_id: vehiculo.id, detalle: `Editó los datos del vehículo ${etiquetaVehiculo(vehiculo)}.${cambios.length ? ` (${cambios.join('; ')})` : ''}` });
    }
    sendJson(res, 200, vehiculo);
  },
  { roles: ['admin', 'mecanico_lider'] }
);

// ==================== CATÁLOGO DE REPUESTOS (por categoría) ====================

route('GET', '/api/catalogo-repuestos', async (req, res, params, query, usuario) => {
  const filas = await catalogoDb.listarPorNegocio(usuario.negocio_id);
  const extra = {};
  const ocultos = {};
  for (const f of filas) {
    const destino = Number(f.oculto) ? ocultos : extra;
    if (!destino[f.categoria]) destino[f.categoria] = [];
    destino[f.categoria].push(f.nombre);
  }
  sendJson(res, 200, { extra, ocultos });
});

route(
  'POST',
  '/api/catalogo-repuestos',
  async (req, res, params, query, usuario) => {
    const body = await readBody(req);
    const nombre = (body.nombre || '').trim();
    const categoria = (body.categoria || '').trim();
    if (!nombre) return sendError(res, 400, 'Falta el nombre del repuesto');
    if (!CATEGORIAS_REPUESTO.includes(categoria)) return sendError(res, 400, `Categoría inválida. Debe ser una de: ${CATEGORIAS_REPUESTO.join(', ')}`);
    const existente = await catalogoDb.buscar(usuario.negocio_id, categoria, nombre);
    if (!existente) {
      await catalogoDb.crear(usuario.negocio_id, { categoria, nombre, oculto: 0, creado_en: ahora() });
    } else if (Number(existente.oculto)) {
      await catalogoDb.marcarOculto(usuario.negocio_id, existente.id, 0);
    }
    sendJson(res, 201, { ok: true, categoria, nombre });
  },
  { roles: ['admin', 'mecanico_lider'] }
);

route(
  'DELETE',
  '/api/catalogo-repuestos',
  async (req, res, params, query, usuario) => {
    const body = await readBody(req);
    const nombre = (body.nombre || '').trim();
    const categoria = (body.categoria || '').trim();
    if (!nombre) return sendError(res, 400, 'Falta el nombre del repuesto');
    if (!CATEGORIAS_REPUESTO.includes(categoria)) return sendError(res, 400, `Categoría inválida. Debe ser una de: ${CATEGORIAS_REPUESTO.join(', ')}`);
    if (body.es_default) {
      const existente = await catalogoDb.buscar(usuario.negocio_id, categoria, nombre);
      if (existente) await catalogoDb.marcarOculto(usuario.negocio_id, existente.id, 1);
      else await catalogoDb.crear(usuario.negocio_id, { categoria, nombre, oculto: 1, creado_en: ahora() });
    } else {
      const existente = await catalogoDb.buscar(usuario.negocio_id, categoria, nombre);
      if (existente) await catalogoDb.eliminar(usuario.negocio_id, existente.id);
    }
    await registrarAuditoria(usuario, {
      accion: 'catalogo_repuesto_eliminado',
      entidad_tipo: 'catalogo_repuestos',
      entidad_id: null,
      detalle: `Sacó "${nombre}" de la lista de repuestos de la categoría "${categoria}".`,
    });
    sendJson(res, 200, { ok: true });
  },
  { roles: ['admin', 'mecanico_lider'] }
);

// ==================== INVENTARIO ====================
// Por decisión del usuario, sin fotos (igual que el taller mecánico, ver
// DISEÑO-FIRESTORE.md) — así no se depende de Cloud Storage ni de ningún
// servicio externo solo para guardar imágenes.

async function enriquecerConVehiculo(item, usuario) {
  if (!item.vehiculo_id) return item;
  const v = await vehiculosDb.obtener(usuario.negocio_id, item.vehiculo_id);
  return {
    ...item,
    vehiculo_numero: v ? v.numero : null,
    vehiculo_patente: v ? v.patente : null,
    vehiculo_marca: v ? v.marca : null,
    vehiculo_modelo: v ? v.modelo : null,
  };
}

route('GET', '/api/inventario', async (req, res, params, query, usuario) => {
  let data = await inventarioDb.listarPorNegocio(usuario.negocio_id);
  const q = query.get('q');
  if (q) {
    const qLower = q.toLowerCase();
    data = data.filter((i) => (i.nombre || '').toLowerCase().includes(qLower) || (i.codigo || '').toLowerCase().includes(qLower));
  }
  if (query.get('categoria')) data = data.filter((i) => i.categoria === query.get('categoria'));
  if (query.get('vehiculo_id')) data = data.filter((i) => i.vehiculo_id === query.get('vehiculo_id'));
  if (query.get('bajo_stock') === '1') data = data.filter((i) => i.cantidad_disponible <= i.cantidad_minima);
  data.sort((a, b) => a.nombre.localeCompare(b.nombre));
  data = await Promise.all(data.map((i) => enriquecerConVehiculo(i, usuario)));
  sendJson(res, 200, data);
});

route('GET', '/api/inventario/:id', async (req, res, params, query, usuario) => {
  const item = await inventarioDb.obtener(usuario.negocio_id, params.id);
  if (!item) return sendError(res, 404, 'Repuesto no encontrado');
  sendJson(res, 200, await enriquecerConVehiculo(item, usuario));
});

route(
  'POST',
  '/api/inventario',
  async (req, res, params, query, usuario) => {
    const body = await readBody(req);
    if (!body.nombre || !body.nombre.trim()) return sendError(res, 400, 'Falta el nombre del repuesto');
    if (body.vehiculo_id) {
      const vehiculo = await vehiculosDb.obtener(usuario.negocio_id, body.vehiculo_id);
      if (!vehiculo) return sendError(res, 400, 'El vehículo indicado no existe');
    }
    const datos = {
      vehiculo_id: body.vehiculo_id || null,
      codigo: body.codigo || null,
      nombre: body.nombre.trim(),
      categoria: body.categoria || 'Otro',
      cantidad_disponible: Number(body.cantidad_disponible) || 0,
      cantidad_minima: Number(body.cantidad_minima) || 1,
      precio_venta: Number(body.precio_venta) || 0,
      costo_unitario: Number(body.costo_unitario) || 0,
      ubicacion: body.ubicacion || null,
      fecha_ingreso: ahora(),
      activo: 1,
    };
    const id = await inventarioDb.crear(usuario.negocio_id, datos);
    const item = { id, ...datos };
    await registrarAuditoria(usuario, {
      accion: 'inventario_creado',
      entidad_tipo: 'inventario',
      entidad_id: item.id,
      detalle: `Agregó el repuesto "${item.nombre}" (${item.categoria || 'Otro'}, ${item.cantidad_disponible} unid., ${fmtCLPServidor.format(item.precio_venta)})${body.vehiculo_id ? ' ligado a un vehículo' : ''}.`,
    });
    sendJson(res, 201, item);
  },
  { roles: ['admin', 'mecanico_lider'] }
);

route(
  'PATCH',
  '/api/inventario/:id',
  async (req, res, params, query, usuario) => {
    const body = await readBody(req);
    const existe = await inventarioDb.obtener(usuario.negocio_id, params.id);
    if (!existe) return sendError(res, 404, 'Repuesto no encontrado');
    const cambiosDb = {};
    const cambios = [];
    for (const campo of ['codigo', 'nombre', 'categoria', 'ubicacion']) {
      if (body[campo] !== undefined) {
        cambiosDb[campo] = body[campo] || null;
        if (campo === 'categoria' && body.categoria !== existe.categoria) {
          cambios.push(`categoría: ${existe.categoria || 'Otro'} → ${body.categoria || 'Otro'}`);
        }
      }
    }
    for (const campo of ['cantidad_disponible', 'cantidad_minima', 'precio_venta', 'costo_unitario']) {
      if (body[campo] !== undefined) {
        const nuevo = Number(body[campo]) || 0;
        cambiosDb[campo] = nuevo;
        if (nuevo !== existe[campo]) {
          if (campo === 'precio_venta') cambios.push(`precio: ${fmtCLPServidor.format(existe.precio_venta)} → ${fmtCLPServidor.format(nuevo)}`);
          else if (campo === 'cantidad_disponible') cambios.push(`stock: ${existe.cantidad_disponible} → ${nuevo}`);
        }
      }
    }
    if (body.activo !== undefined) {
      const nuevoActivo = body.activo ? 1 : 0;
      cambiosDb.activo = nuevoActivo;
      if (nuevoActivo !== existe.activo) cambios.push(nuevoActivo ? 'reactivado' : 'desactivado');
    }
    if (!Object.keys(cambiosDb).length) return sendError(res, 400, 'Nada para actualizar');
    await inventarioDb.actualizar(usuario.negocio_id, params.id, cambiosDb);
    const item = await inventarioDb.obtener(usuario.negocio_id, params.id);
    if (cambios.length) {
      await registrarAuditoria(usuario, { accion: 'inventario_editado', entidad_tipo: 'inventario', entidad_id: item.id, detalle: `Editó "${item.nombre}": ${cambios.join('; ')}.` });
    }
    sendJson(res, 200, item);
  },
  { roles: ['admin', 'mecanico_lider'] }
);

route(
  'DELETE',
  '/api/inventario/:id',
  async (req, res, params, query, usuario) => {
    const existe = await inventarioDb.obtener(usuario.negocio_id, params.id);
    if (!existe) return sendError(res, 404, 'Repuesto no encontrado');
    const enVentas = await inventarioDb.contarEnVentas(usuario.negocio_id, params.id);
    if (enVentas > 0) {
      return sendError(res, 400, 'No se puede eliminar: este repuesto ya tiene ventas registradas. Puedes desactivarlo en su lugar.');
    }
    await inventarioDb.eliminar(usuario.negocio_id, params.id);
    await registrarAuditoria(usuario, { accion: 'inventario_eliminado', entidad_tipo: 'inventario', entidad_id: params.id, detalle: `Eliminó el repuesto "${existe.nombre}" del inventario.` });
    sendJson(res, 200, { ok: true });
  },
  { roles: ['admin', 'mecanico_lider'] }
);

// ==================== INVENTARIO BODEGA (compra directa) ====================

route('GET', '/api/repisas', async (req, res, params, query, usuario) => {
  sendJson(res, 200, await repisasDb.listarPorNegocio(usuario.negocio_id));
});

route(
  'POST',
  '/api/repisas',
  async (req, res, params, query, usuario) => {
    const body = await readBody(req);
    if (!body.nombre || !body.nombre.trim()) return sendError(res, 400, 'Falta el nombre de la repisa');
    const cantidadFilas = Number(body.cantidad_filas) || 1;
    if (cantidadFilas < 1) return sendError(res, 400, 'La repisa necesita al menos 1 fila');
    const id = await repisasDb.crear(usuario.negocio_id, { nombre: body.nombre.trim(), cantidad_filas: cantidadFilas, creado_en: ahora() });
    const repisa = await repisasDb.obtener(usuario.negocio_id, id);
    await registrarAuditoria(usuario, { accion: 'repisa_creada', entidad_tipo: 'repisa', entidad_id: repisa.id, detalle: `Creó la repisa "${repisa.nombre}" con ${repisa.cantidad_filas} fila(s).` });
    sendJson(res, 201, repisa);
  },
  { roles: ['admin', 'mecanico_lider'] }
);

route(
  'PATCH',
  '/api/repisas/:id',
  async (req, res, params, query, usuario) => {
    const body = await readBody(req);
    const existe = await repisasDb.obtener(usuario.negocio_id, params.id);
    if (!existe) return sendError(res, 404, 'Repisa no encontrada');
    const cambiosDb = {};
    if (body.nombre !== undefined) {
      if (!body.nombre.trim()) return sendError(res, 400, 'El nombre no puede quedar vacío');
      cambiosDb.nombre = body.nombre.trim();
    }
    if (body.cantidad_filas !== undefined) {
      const cantidadFilas = Number(body.cantidad_filas) || 0;
      if (cantidadFilas < 1) return sendError(res, 400, 'La repisa necesita al menos 1 fila');
      const filaMaxima = await repisasDb.filaMaximaEnUso(usuario.negocio_id, params.id);
      if (cantidadFilas < filaMaxima) {
        return sendError(res, 400, `No se puede bajar a ${cantidadFilas} fila(s): ya hay ítems guardados hasta la fila ${filaMaxima}.`);
      }
      cambiosDb.cantidad_filas = cantidadFilas;
    }
    if (!Object.keys(cambiosDb).length) return sendError(res, 400, 'Nada para actualizar');
    await repisasDb.actualizar(usuario.negocio_id, params.id, cambiosDb);
    const repisa = await repisasDb.obtener(usuario.negocio_id, params.id);
    await registrarAuditoria(usuario, { accion: 'repisa_editada', entidad_tipo: 'repisa', entidad_id: repisa.id, detalle: `Editó la repisa "${repisa.nombre}" (${repisa.cantidad_filas} fila(s)).` });
    sendJson(res, 200, repisa);
  },
  { roles: ['admin', 'mecanico_lider'] }
);

route(
  'DELETE',
  '/api/repisas/:id',
  async (req, res, params, query, usuario) => {
    const existe = await repisasDb.obtener(usuario.negocio_id, params.id);
    if (!existe) return sendError(res, 404, 'Repisa no encontrada');
    const enUso = await repisasDb.contarEnUso(usuario.negocio_id, params.id);
    if (enUso > 0) return sendError(res, 400, 'No se puede eliminar: todavía tiene repuestos guardados en ella.');
    await repisasDb.eliminar(usuario.negocio_id, params.id);
    await registrarAuditoria(usuario, { accion: 'repisa_editada', entidad_tipo: 'repisa', entidad_id: params.id, detalle: `Eliminó la repisa "${existe.nombre}".` });
    sendJson(res, 200, { ok: true });
  },
  { roles: ['admin', 'mecanico_lider'] }
);

route('GET', '/api/bodega/compras', async (req, res, params, query, usuario) => {
  sendJson(res, 200, await bodegaDb.listarComprasPorNegocio(usuario.negocio_id));
});

route('GET', '/api/bodega/compras/:id', async (req, res, params, query, usuario) => {
  const compra = await bodegaDb.obtenerCompra(usuario.negocio_id, params.id);
  if (!compra) return sendError(res, 404, 'Compra no encontrada');
  const piezas = await bodegaDb.listarPorCompra(usuario.negocio_id, params.id);
  compra.piezas = await Promise.all(
    piezas.map(async (p) => {
      const repisa = p.repisa_id ? await repisasDb.obtener(usuario.negocio_id, p.repisa_id) : null;
      return { ...p, repisa_nombre: repisa ? repisa.nombre : null };
    })
  );
  sendJson(res, 200, compra);
});

route(
  'POST',
  '/api/bodega/compras',
  async (req, res, params, query, usuario) => {
    const body = await readBody(req);
    if (!body.nombre || !body.nombre.trim()) return sendError(res, 400, 'Falta el nombre de la compra (ej: "Motor")');
    const numero = await bodegaDb.siguienteNumeroCompra(usuario.negocio_id);
    await bodegaDb.crearCompra(usuario.negocio_id, numero, {
      nombre: body.nombre.trim(),
      proveedor: body.proveedor || null,
      costo_total: Number(body.costo_total) || 0,
      observaciones: body.observaciones || null,
      fecha_ingreso: ahora(),
    });
    const compra = await bodegaDb.obtenerCompra(usuario.negocio_id, numero);
    await registrarAuditoria(usuario, {
      accion: 'bodega_compra_creada',
      entidad_tipo: 'compra_bodega',
      entidad_id: compra.id,
      detalle: `Registró la compra bodega N°${compra.numero} — "${compra.nombre}"${body.proveedor ? ` (proveedor: ${body.proveedor})` : ''}.`,
    });
    sendJson(res, 201, compra);
  },
  { roles: ['admin', 'mecanico_lider'] }
);

route(
  'PATCH',
  '/api/bodega/compras/:id',
  async (req, res, params, query, usuario) => {
    const body = await readBody(req);
    const existe = await bodegaDb.obtenerCompra(usuario.negocio_id, params.id);
    if (!existe) return sendError(res, 404, 'Compra no encontrada');
    const cambiosDb = {};
    for (const campo of ['nombre', 'proveedor', 'observaciones']) {
      if (body[campo] !== undefined) cambiosDb[campo] = body[campo] || null;
    }
    if (body.costo_total !== undefined) cambiosDb.costo_total = Number(body.costo_total) || 0;
    if (!Object.keys(cambiosDb).length) return sendError(res, 400, 'Nada para actualizar');
    await bodegaDb.actualizarCompra(usuario.negocio_id, params.id, cambiosDb);
    const compra = await bodegaDb.obtenerCompra(usuario.negocio_id, params.id);
    await registrarAuditoria(usuario, { accion: 'bodega_compra_editada', entidad_tipo: 'compra_bodega', entidad_id: compra.id, detalle: `Editó la compra bodega N°${compra.numero} — "${compra.nombre}".` });
    sendJson(res, 200, compra);
  },
  { roles: ['admin', 'mecanico_lider'] }
);

async function validarUbicacionBodega(negocioId, repisaId, fila) {
  if (!repisaId) return null;
  const repisa = await repisasDb.obtener(negocioId, repisaId);
  if (!repisa) return 'La repisa indicada no existe';
  const filaNum = Number(fila) || 1;
  if (filaNum < 1 || filaNum > repisa.cantidad_filas) {
    return `La fila debe estar entre 1 y ${repisa.cantidad_filas} para la repisa "${repisa.nombre}"`;
  }
  return null;
}

async function enriquecerPiezaBodega(item, usuario) {
  const compra = item.compra_id ? await bodegaDb.obtenerCompra(usuario.negocio_id, item.compra_id) : null;
  const repisa = item.repisa_id ? await repisasDb.obtener(usuario.negocio_id, item.repisa_id) : null;
  return {
    ...item,
    compra_numero: compra ? compra.numero : null,
    compra_nombre: compra ? compra.nombre : null,
    repisa_nombre: repisa ? repisa.nombre : null,
  };
}

route('GET', '/api/bodega/inventario', async (req, res, params, query, usuario) => {
  let data = await bodegaDb.listarPiezasPorNegocio(usuario.negocio_id);
  const q = query.get('q');
  if (q) {
    const qLower = q.toLowerCase();
    data = data.filter((i) => (i.nombre || '').toLowerCase().includes(qLower) || (i.codigo || '').toLowerCase().includes(qLower));
  }
  if (query.get('categoria')) data = data.filter((i) => i.categoria === query.get('categoria'));
  if (query.get('compra_id')) data = data.filter((i) => i.compra_id === query.get('compra_id'));
  if (query.get('bajo_stock') === '1') data = data.filter((i) => i.cantidad_disponible <= i.cantidad_minima);
  data.sort((a, b) => a.nombre.localeCompare(b.nombre));
  data = await Promise.all(data.map((i) => enriquecerPiezaBodega(i, usuario)));
  sendJson(res, 200, data);
});

route('GET', '/api/bodega/inventario/:id', async (req, res, params, query, usuario) => {
  const item = await bodegaDb.obtenerPieza(usuario.negocio_id, params.id);
  if (!item) return sendError(res, 404, 'Repuesto no encontrado');
  sendJson(res, 200, await enriquecerPiezaBodega(item, usuario));
});

route(
  'POST',
  '/api/bodega/inventario',
  async (req, res, params, query, usuario) => {
    const body = await readBody(req);
    if (!body.nombre || !body.nombre.trim()) return sendError(res, 400, 'Falta el nombre del repuesto');
    if (body.compra_id) {
      const compra = await bodegaDb.obtenerCompra(usuario.negocio_id, body.compra_id);
      if (!compra) return sendError(res, 400, 'La compra indicada no existe');
    }
    const errorUbicacion = await validarUbicacionBodega(usuario.negocio_id, body.repisa_id, body.fila);
    if (errorUbicacion) return sendError(res, 400, errorUbicacion);
    const id = await bodegaDb.crearPieza(usuario.negocio_id, {
      compra_id: body.compra_id || null,
      codigo: body.codigo || null,
      nombre: body.nombre.trim(),
      categoria: body.categoria || 'Otro',
      cantidad_disponible: Number(body.cantidad_disponible) || 0,
      cantidad_minima: Number(body.cantidad_minima) || 1,
      precio_venta: Number(body.precio_venta) || 0,
      costo_unitario: Number(body.costo_unitario) || 0,
      repisa_id: body.repisa_id || null,
      fila: body.repisa_id ? Number(body.fila) || 1 : null,
      fecha_ingreso: ahora(),
      activo: 1,
    });
    const item = await bodegaDb.obtenerPieza(usuario.negocio_id, id);
    await registrarAuditoria(usuario, {
      accion: 'bodega_inventario_creado',
      entidad_tipo: 'inventario_bodega',
      entidad_id: item.id,
      detalle: `Agregó a Inventario Bodega el repuesto "${item.nombre}" (${item.categoria || 'Otro'}, ${item.cantidad_disponible} unid., ${fmtCLPServidor.format(item.precio_venta)}).`,
    });
    sendJson(res, 201, item);
  },
  { roles: ['admin', 'mecanico_lider'] }
);

route(
  'PATCH',
  '/api/bodega/inventario/:id',
  async (req, res, params, query, usuario) => {
    const body = await readBody(req);
    const existe = await bodegaDb.obtenerPieza(usuario.negocio_id, params.id);
    if (!existe) return sendError(res, 404, 'Repuesto no encontrado');
    const cambiosDb = {};
    const cambios = [];
    for (const campo of ['codigo', 'nombre', 'categoria']) {
      if (body[campo] !== undefined) {
        cambiosDb[campo] = body[campo] || null;
        if (campo === 'categoria' && body.categoria !== existe.categoria) {
          cambios.push(`categoría: ${existe.categoria || 'Otro'} → ${body.categoria || 'Otro'}`);
        }
      }
    }
    for (const campo of ['cantidad_disponible', 'cantidad_minima', 'precio_venta', 'costo_unitario']) {
      if (body[campo] !== undefined) {
        const nuevo = Number(body[campo]) || 0;
        cambiosDb[campo] = nuevo;
        if (nuevo !== existe[campo]) {
          if (campo === 'precio_venta') cambios.push(`precio: ${fmtCLPServidor.format(existe.precio_venta)} → ${fmtCLPServidor.format(nuevo)}`);
          else if (campo === 'cantidad_disponible') cambios.push(`stock: ${existe.cantidad_disponible} → ${nuevo}`);
        }
      }
    }
    if (body.repisa_id !== undefined || body.fila !== undefined) {
      const repisaId = body.repisa_id !== undefined ? body.repisa_id : existe.repisa_id;
      const fila = body.fila !== undefined ? body.fila : existe.fila;
      const errorUbicacion = await validarUbicacionBodega(usuario.negocio_id, repisaId, fila);
      if (errorUbicacion) return sendError(res, 400, errorUbicacion);
      cambiosDb.repisa_id = repisaId || null;
      cambiosDb.fila = repisaId ? Number(fila) || 1 : null;
      cambios.push('ubicación actualizada');
    }
    if (body.activo !== undefined) {
      const nuevoActivo = body.activo ? 1 : 0;
      cambiosDb.activo = nuevoActivo;
      if (nuevoActivo !== existe.activo) cambios.push(nuevoActivo ? 'reactivado' : 'desactivado');
    }
    if (!Object.keys(cambiosDb).length) return sendError(res, 400, 'Nada para actualizar');
    await bodegaDb.actualizarPieza(usuario.negocio_id, params.id, cambiosDb);
    const item = await bodegaDb.obtenerPieza(usuario.negocio_id, params.id);
    if (cambios.length) {
      await registrarAuditoria(usuario, { accion: 'bodega_inventario_editado', entidad_tipo: 'inventario_bodega', entidad_id: item.id, detalle: `Editó en Inventario Bodega "${item.nombre}": ${cambios.join('; ')}.` });
    }
    sendJson(res, 200, item);
  },
  { roles: ['admin', 'mecanico_lider'] }
);

route(
  'DELETE',
  '/api/bodega/inventario/:id',
  async (req, res, params, query, usuario) => {
    const existe = await bodegaDb.obtenerPieza(usuario.negocio_id, params.id);
    if (!existe) return sendError(res, 404, 'Repuesto no encontrado');
    const enVentas = await bodegaDb.contarPiezaEnVentas(usuario.negocio_id, params.id);
    if (enVentas > 0) return sendError(res, 400, 'No se puede eliminar: este repuesto ya tiene ventas registradas. Puedes desactivarlo en su lugar.');
    await bodegaDb.eliminarPieza(usuario.negocio_id, params.id);
    await registrarAuditoria(usuario, { accion: 'bodega_inventario_eliminado', entidad_tipo: 'inventario_bodega', entidad_id: params.id, detalle: `Eliminó de Inventario Bodega el repuesto "${existe.nombre}".` });
    sendJson(res, 200, { ok: true });
  },
  { roles: ['admin', 'mecanico_lider'] }
);

// ==================== VENTAS ====================
// Igual que en la versión SQL: cada ítem muestra de dónde salió el repuesto
// (de qué vehículo, o de qué compra de bodega) — como ya no hay JOIN, esa
// info se busca aparte por cada ítem, en el momento de leer la venta (igual
// de "en vivo" que el JOIN original: si el repuesto cambió de categoría
// después de la venta, el ticket viejo lo refleja igual que antes).

async function enriquecerItemVenta(it, usuario) {
  if (it.origen === 'bodega' && it.inventario_bodega_id) {
    const pieza = await bodegaDb.obtenerPieza(usuario.negocio_id, it.inventario_bodega_id);
    const compra = pieza && pieza.compra_id ? await bodegaDb.obtenerCompra(usuario.negocio_id, pieza.compra_id) : null;
    return { ...it, bodega_numero: compra ? compra.numero : it.bodega_numero || null, bodega_compra_nombre: compra ? compra.nombre : it.bodega_compra_nombre || null };
  }
  if (it.inventario_id) {
    const repuesto = await inventarioDb.obtener(usuario.negocio_id, it.inventario_id);
    const vehiculo = repuesto && repuesto.vehiculo_id ? await vehiculosDb.obtener(usuario.negocio_id, repuesto.vehiculo_id) : null;
    return {
      ...it,
      vehiculo_numero: vehiculo ? vehiculo.numero : null,
      vehiculo_patente: vehiculo ? vehiculo.patente : null,
      vehiculo_marca: vehiculo ? vehiculo.marca : null,
      vehiculo_modelo: vehiculo ? vehiculo.modelo : null,
    };
  }
  return it;
}

async function enriquecerVenta(venta, usuario) {
  const vendedor = await usuariosDb.obtenerPorUsername(venta.usuario);
  venta.vendedor_nombre = vendedor ? vendedor.nombre : venta.usuario;
  venta.items = await Promise.all((venta.items || []).map((it) => enriquecerItemVenta(it, usuario)));
  return venta;
}

route('GET', '/api/ventas', async (req, res, params, query, usuario) => {
  const data = await ventasDb.listarPorNegocio(usuario.negocio_id, { desde: query.get('desde'), hasta: query.get('hasta') });
  sendJson(res, 200, await Promise.all(data.map((v) => enriquecerVenta(v, usuario))));
});

route('GET', '/api/ventas/:id', async (req, res, params, query, usuario) => {
  const venta = await ventasDb.obtener(usuario.negocio_id, params.id);
  if (!venta) return sendError(res, 404, 'Venta no encontrada');
  sendJson(res, 200, await enriquecerVenta(venta, usuario));
});

route('POST', '/api/ventas', async (req, res, params, query, usuario) => {
  const body = await readBody(req);
  if (!Array.isArray(body.items) || body.items.length === 0) return sendError(res, 400, 'La venta necesita al menos un repuesto');
  if (!TIPOS_PAGO.includes(body.tipo_pago)) return sendError(res, 400, `Tipo de pago inválido. Debe ser una de: ${TIPOS_PAGO.join(', ')}`);

  const itemsResueltos = [];
  for (const it of body.items) {
    const cantidad = Number(it.cantidad) || 0;
    if (cantidad <= 0) continue;
    if (it.origen === 'bodega' && it.inventario_bodega_id) {
      const repuesto = await bodegaDb.obtenerPieza(usuario.negocio_id, it.inventario_bodega_id);
      if (!repuesto) return sendError(res, 400, `Repuesto de bodega #${it.inventario_bodega_id} no encontrado`);
      if (repuesto.cantidad_disponible < cantidad) {
        return sendError(res, 400, `No hay stock suficiente de "${repuesto.nombre}" en Inventario Bodega (disponible: ${repuesto.cantidad_disponible})`);
      }
      const compra = repuesto.compra_id ? await bodegaDb.obtenerCompra(usuario.negocio_id, repuesto.compra_id) : null;
      itemsResueltos.push({
        inventario_id: null,
        inventario_bodega_id: repuesto.id,
        origen: 'bodega',
        bodega_numero: compra ? compra.numero : null,
        bodega_compra_nombre: compra ? compra.nombre : null,
        nombre_repuesto: repuesto.nombre,
        categoria: repuesto.categoria,
        cantidad,
        precio_unitario: it.precio_unitario !== undefined ? Number(it.precio_unitario) : repuesto.precio_venta,
      });
    } else if (it.inventario_id) {
      const repuesto = await inventarioDb.obtener(usuario.negocio_id, it.inventario_id);
      if (!repuesto) return sendError(res, 400, `Repuesto #${it.inventario_id} no encontrado`);
      if (repuesto.cantidad_disponible < cantidad) {
        return sendError(res, 400, `No hay stock suficiente de "${repuesto.nombre}" (disponible: ${repuesto.cantidad_disponible})`);
      }
      itemsResueltos.push({
        inventario_id: repuesto.id,
        inventario_bodega_id: null,
        origen: 'vehiculo',
        nombre_repuesto: repuesto.nombre,
        categoria: repuesto.categoria,
        cantidad,
        precio_unitario: it.precio_unitario !== undefined ? Number(it.precio_unitario) : repuesto.precio_venta,
      });
    } else if (it.nombre_repuesto) {
      itemsResueltos.push({
        inventario_id: null,
        inventario_bodega_id: null,
        origen: 'vehiculo',
        nombre_repuesto: it.nombre_repuesto,
        categoria: it.categoria || 'Otro',
        cantidad,
        precio_unitario: Number(it.precio_unitario) || 0,
      });
    }
  }
  if (itemsResueltos.length === 0) return sendError(res, 400, 'La venta necesita al menos un repuesto válido');

  const total = totalVenta(itemsResueltos);
  const datosVenta = {
    usuario: usuario.usuario,
    fecha: ahora(),
    total,
    tipo_pago: body.tipo_pago,
    cliente_nombre: body.cliente_nombre || null,
    cliente_telefono: body.cliente_telefono || null,
    estado: 'completada',
    notificacion_whatsapp_estado: 'no_configurado',
    items: itemsResueltos,
  };
  const ventaId = await ventasDb.crear(usuario.negocio_id, datosVenta);

  // Descuento de stock con FieldValue.increment (atómico: no hace falta leer
  // primero la cantidad actual, Firestore suma/resta directo en el servidor).
  for (const it of itemsResueltos) {
    if (it.inventario_id) await inventarioDb.actualizar(usuario.negocio_id, it.inventario_id, { cantidad_disponible: FieldValue.increment(-it.cantidad) });
    if (it.inventario_bodega_id) await bodegaDb.actualizarPieza(usuario.negocio_id, it.inventario_bodega_id, { cantidad_disponible: FieldValue.increment(-it.cantidad) });
  }

  const venta = { id: ventaId, ...datosVenta };

  await registrarAuditoria(usuario, {
    accion: 'venta_creada',
    entidad_tipo: 'venta',
    entidad_id: ventaId,
    detalle: `Vendió ${itemsResueltos.map((it) => `${it.cantidad}× ${it.nombre_repuesto}${it.origen === 'bodega' ? ' [Inventario Bodega]' : ''} (${fmtCLPServidor.format(it.precio_unitario)} c/u)`).join(', ')} — total ${fmtCLPServidor.format(total)}, pago ${body.tipo_pago}${body.cliente_nombre ? `, cliente ${body.cliente_nombre}` : ''}.`,
  });

  const negocio = await negociosDb.obtenerPorId(usuario.negocio_id);
  const estadoNotificacion = await notificaciones.notificarVenta({ negocio, venta, items: itemsResueltos, vendedor: usuario });
  await ventasDb.actualizar(usuario.negocio_id, ventaId, { notificacion_whatsapp_estado: estadoNotificacion });
  venta.notificacion_whatsapp_estado = estadoNotificacion;

  sendJson(res, 201, venta);
});

route(
  'PATCH',
  '/api/ventas/:id',
  async (req, res, params, query, usuario) => {
    const body = await readBody(req);
    if (body.estado !== 'anulada') return sendError(res, 400, 'Solo se puede anular una venta desde acá');
    const venta = await ventasDb.obtener(usuario.negocio_id, params.id);
    if (!venta) return sendError(res, 404, 'Venta no encontrada');
    if (venta.estado === 'anulada') return sendError(res, 400, 'Esta venta ya estaba anulada');
    for (const it of venta.items || []) {
      if (it.inventario_id) await inventarioDb.actualizar(usuario.negocio_id, it.inventario_id, { cantidad_disponible: FieldValue.increment(it.cantidad) });
      if (it.inventario_bodega_id) await bodegaDb.actualizarPieza(usuario.negocio_id, it.inventario_bodega_id, { cantidad_disponible: FieldValue.increment(it.cantidad) });
    }
    await ventasDb.actualizar(usuario.negocio_id, params.id, { estado: 'anulada' });
    await registrarAuditoria(usuario, {
      accion: 'venta_anulada',
      entidad_tipo: 'venta',
      entidad_id: params.id,
      detalle: `Anuló la venta #${params.id} (total ${fmtCLPServidor.format(venta.total)}) y repuso el stock.`,
    });
    sendJson(res, 200, { ok: true });
  },
  { roles: ['admin'] }
);

// ==================== TALLER MECÁNICO (reparaciones) ====================
// Sin carga de fotos en esta versión (decisión tomada para no aumentar el
// uso de almacenamiento en Firebase — ver DISEÑO-FIRESTORE.md). El PDF de
// entrega queda solo con los datos de texto, sin las grillas de fotos que
// tenía la versión SQL.

route(
  'GET',
  '/api/taller/ordenes',
  async (req, res, params, query, usuario) => {
    const estado = query.get('estado');
    if (estado && !['en_taller', 'entregado'].includes(estado)) return sendError(res, 400, 'Estado inválido');
    sendJson(res, 200, await tallerDb.listarPorNegocio(usuario.negocio_id, estado));
  },
  { roles: ['admin', 'mecanico_lider'] }
);

route(
  'GET',
  '/api/taller/ordenes/:id',
  async (req, res, params, query, usuario) => {
    const orden = await tallerDb.obtener(usuario.negocio_id, params.id);
    if (!orden) return sendError(res, 404, 'Orden no encontrada');
    sendJson(res, 200, orden);
  },
  { roles: ['admin', 'mecanico_lider'] }
);

route(
  'POST',
  '/api/taller/ordenes',
  async (req, res, params, query, usuario) => {
    const body = await readBody(req);
    if (!body.dueno_nombre || !body.dueno_nombre.trim()) return sendError(res, 400, 'Falta el nombre del dueño');
    if (!body.vehiculo_patente || !body.vehiculo_patente.trim()) return sendError(res, 400, 'Falta la patente del vehículo');
    const numero = await tallerDb.siguienteNumero(usuario.negocio_id);
    await tallerDb.crear(usuario.negocio_id, numero, {
      dueno_nombre: body.dueno_nombre.trim(),
      dueno_telefono: body.dueno_telefono || null,
      dueno_rut: body.dueno_rut || null,
      vehiculo_patente: body.vehiculo_patente.trim().toUpperCase(),
      vehiculo_marca: body.vehiculo_marca || null,
      vehiculo_modelo: body.vehiculo_modelo || null,
      vehiculo_anio: body.vehiculo_anio || null,
      vehiculo_color: body.vehiculo_color || null,
      comentario_ingreso: body.comentario_ingreso || null,
      presupuesto_monto: Number(body.presupuesto_monto) || 0,
      presupuesto_notas: body.presupuesto_notas || null,
      trabajos_realizados: null,
      cobro_final: null,
      estado: 'en_taller',
      fecha_ingreso: ahora(),
      fecha_entrega: null,
    });
    const orden = await tallerDb.obtener(usuario.negocio_id, numero);
    await registrarAuditoria(usuario, { accion: 'taller_orden_creada', entidad_tipo: 'taller_orden', entidad_id: orden.id, detalle: `Ingresó al taller el vehículo ${etiquetaOrdenTaller(orden)}.` });
    sendJson(res, 201, orden);
  },
  { roles: ['admin', 'mecanico_lider'] }
);

route(
  'PATCH',
  '/api/taller/ordenes/:id',
  async (req, res, params, query, usuario) => {
    const body = await readBody(req);
    const existe = await tallerDb.obtener(usuario.negocio_id, params.id);
    if (!existe) return sendError(res, 404, 'Orden no encontrada');
    const cambiosDb = {};
    const cambios = [];
    for (const campo of ['dueno_nombre', 'dueno_telefono', 'dueno_rut', 'vehiculo_marca', 'vehiculo_modelo', 'vehiculo_anio', 'vehiculo_color', 'comentario_ingreso', 'presupuesto_notas', 'trabajos_realizados']) {
      if (body[campo] !== undefined) cambiosDb[campo] = body[campo] || null;
    }
    if (body.vehiculo_patente !== undefined) {
      const nueva = body.vehiculo_patente && body.vehiculo_patente.trim() ? body.vehiculo_patente.trim().toUpperCase() : existe.vehiculo_patente;
      cambiosDb.vehiculo_patente = nueva;
      if (nueva !== existe.vehiculo_patente) cambios.push(`patente: ${existe.vehiculo_patente} → ${nueva}`);
    }
    for (const campo of ['presupuesto_monto', 'cobro_final']) {
      if (body[campo] !== undefined) {
        const nuevo = Number(body[campo]) || 0;
        cambiosDb[campo] = nuevo;
        if (nuevo !== existe[campo]) cambios.push(`${campo === 'presupuesto_monto' ? 'presupuesto' : 'cobro final'}: ${fmtCLPServidor.format(existe[campo] || 0)} → ${fmtCLPServidor.format(nuevo)}`);
      }
    }
    if (!Object.keys(cambiosDb).length) return sendError(res, 400, 'Nada para actualizar');
    await tallerDb.actualizar(usuario.negocio_id, params.id, cambiosDb);
    const orden = await tallerDb.obtener(usuario.negocio_id, params.id);
    await registrarAuditoria(usuario, { accion: 'taller_orden_editada', entidad_tipo: 'taller_orden', entidad_id: orden.id, detalle: `Editó la orden ${etiquetaOrdenTaller(orden)}.${cambios.length ? ` (${cambios.join('; ')})` : ''}` });
    sendJson(res, 200, orden);
  },
  { roles: ['admin', 'mecanico_lider'] }
);

route(
  'POST',
  '/api/taller/ordenes/:id/entregar',
  async (req, res, params, query, usuario) => {
    const body = await readBody(req);
    const existe = await tallerDb.obtener(usuario.negocio_id, params.id);
    if (!existe) return sendError(res, 404, 'Orden no encontrada');
    if (existe.estado === 'entregado') return sendError(res, 400, 'Este vehículo ya fue entregado');
    const cobroFinal = body.cobro_final !== undefined && body.cobro_final !== null && body.cobro_final !== '' ? Number(body.cobro_final) || 0 : existe.presupuesto_monto;
    await tallerDb.actualizar(usuario.negocio_id, params.id, {
      estado: 'entregado',
      fecha_entrega: ahora(),
      trabajos_realizados: body.trabajos_realizados || null,
      cobro_final: cobroFinal,
    });
    const orden = await tallerDb.obtener(usuario.negocio_id, params.id);
    await registrarAuditoria(usuario, { accion: 'taller_orden_entregada', entidad_tipo: 'taller_orden', entidad_id: orden.id, detalle: `Entregó el vehículo ${etiquetaOrdenTaller(orden)} — cobro final: ${fmtCLPServidor.format(cobroFinal)}.` });
    sendJson(res, 200, orden);
  },
  { roles: ['admin', 'mecanico_lider'] }
);

route(
  'GET',
  '/api/taller/ordenes/:id/pdf',
  async (req, res, params, query, usuario) => {
    const orden = await tallerDb.obtener(usuario.negocio_id, params.id);
    if (!orden) return sendError(res, 404, 'Orden no encontrada');
    if (orden.estado !== 'entregado') return sendError(res, 400, 'Primero debes entregar el vehículo para generar el PDF');

    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const partes = [];
    doc.on('data', (chunk) => partes.push(chunk));
    const fin = new Promise((resolve) => doc.on('end', resolve));

    doc.fontSize(18).fillColor('#d81d2b').text(usuario.negocio_nombre || 'Taller mecánico', { continued: false });
    doc.fontSize(14).fillColor('#17181c').text(`Orden de trabajo N°${orden.numero}`);
    doc.moveDown(0.8);

    doc.fontSize(10).fillColor('#6b7280');
    doc.text(`Ingreso: ${new Date(orden.fecha_ingreso).toLocaleString('es-CL')}`);
    doc.text(`Entrega: ${orden.fecha_entrega ? new Date(orden.fecha_entrega).toLocaleString('es-CL') : '—'}`);
    doc.moveDown(0.8);

    doc.fontSize(12).fillColor('#17181c').text('Datos del cliente', { underline: true });
    doc.fontSize(10).fillColor('#374151');
    doc.text(`Nombre: ${orden.dueno_nombre}`);
    if (orden.dueno_telefono) doc.text(`Teléfono: ${orden.dueno_telefono}`);
    if (orden.dueno_rut) doc.text(`RUT: ${orden.dueno_rut}`);
    doc.moveDown(0.6);

    doc.fontSize(12).fillColor('#17181c').text('Datos del vehículo', { underline: true });
    doc.fontSize(10).fillColor('#374151');
    doc.text(`Patente: ${orden.vehiculo_patente}`);
    doc.text(`Marca / Modelo: ${[orden.vehiculo_marca, orden.vehiculo_modelo].filter(Boolean).join(' ') || '—'}`);
    if (orden.vehiculo_anio) doc.text(`Año: ${orden.vehiculo_anio}`);
    if (orden.vehiculo_color) doc.text(`Color: ${orden.vehiculo_color}`);
    doc.moveDown(0.6);

    if (orden.comentario_ingreso) {
      doc.fontSize(12).fillColor('#17181c').text('Lo solicitado al ingreso', { underline: true });
      doc.fontSize(10).fillColor('#374151').text(orden.comentario_ingreso);
      doc.moveDown(0.6);
    }

    doc.fontSize(12).fillColor('#17181c').text('Trabajos realizados', { underline: true });
    doc.fontSize(10).fillColor('#374151').text(orden.trabajos_realizados || '(sin detalle registrado)');
    doc.moveDown(0.8);

    const anchoUtil = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const cobroBoxY = doc.y;
    const cobroBoxAlto = 40;
    doc.rect(doc.page.margins.left, cobroBoxY, anchoUtil, cobroBoxAlto).fill('#fef2f2');
    doc.fillColor('#d81d2b').fontSize(14).text(`Total cobrado: ${fmtCLPServidor.format(orden.cobro_final || 0)}`, doc.page.margins.left + 12, cobroBoxY + 12);
    doc.x = doc.page.margins.left;
    doc.y = cobroBoxY + cobroBoxAlto + 16;
    doc.fillColor('#17181c');

    doc.end();
    await fin;
    const buffer = Buffer.concat(partes);
    res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="orden-taller-${orden.numero}.pdf"` });
    res.end(buffer);
  },
  { roles: ['admin', 'mecanico_lider'] }
);

// ==================== CARGA MASIVA (EXCEL) ====================
//
// Permite cargar muchos repuestos de una vez desde un archivo Excel (.xlsx)
// con dos hojas: "Inventario" (repuestos de vehículos desarmados, o
// genéricos) e "Inventario Bodega" (repuestos de compra directa). Se valida
// TODO el archivo primero: si hay un solo error, no se guarda nada, para
// evitar cargas a medias. El archivo viaja como el resto de la app: en
// base64 dentro del cuerpo JSON (no hay parser de multipart/form-data, ver
// readBody() más arriba). Idéntico al original salvo el acceso a datos:
// las búsquedas de vehículo/repisa por caché y los INSERT pasan a ser
// lecturas y escrituras en los db/*.js de Firestore.

const NOMBRE_HOJA_INVENTARIO = 'Inventario';
const NOMBRE_HOJA_BODEGA = 'Inventario Bodega';

const COLUMNAS_INVENTARIO = [
  { titulo: 'N° de vehículo (opcional)', ancho: 20 },
  { titulo: 'Marca (si es vehículo nuevo)', ancho: 18 },
  { titulo: 'Modelo (si es vehículo nuevo)', ancho: 18 },
  { titulo: 'Año (si es vehículo nuevo)', ancho: 14 },
  { titulo: 'Origen (si es vehículo nuevo)', ancho: 20 },
  { titulo: 'Observaciones del vehículo (si es nuevo)', ancho: 26 },
  { titulo: 'Nombre', ancho: 28 },
  { titulo: 'Categoría', ancho: 16 },
  { titulo: 'Código', ancho: 14 },
  { titulo: 'Cantidad disponible', ancho: 16 },
  { titulo: 'Cantidad mínima', ancho: 14 },
  { titulo: 'Precio venta', ancho: 14 },
  { titulo: 'Costo unitario', ancho: 14 },
  { titulo: 'Ubicación', ancho: 18 },
];

const COLUMNAS_BODEGA = [
  { titulo: 'Nombre de compra', ancho: 20 },
  { titulo: 'Nombre', ancho: 28 },
  { titulo: 'Categoría', ancho: 16 },
  { titulo: 'Código', ancho: 14 },
  { titulo: 'Cantidad disponible', ancho: 16 },
  { titulo: 'Cantidad mínima', ancho: 14 },
  { titulo: 'Precio venta', ancho: 14 },
  { titulo: 'Costo unitario', ancho: 14 },
  { titulo: 'Repisa (opcional)', ancho: 18 },
  { titulo: 'Fila (opcional)', ancho: 12 },
  { titulo: 'Proveedor (de la compra)', ancho: 20 },
  { titulo: 'Costo total (de la compra)', ancho: 20 },
  { titulo: 'Observaciones (de la compra)', ancho: 26 },
];

function valorCelda(fila, col) {
  const v = fila.getCell(col).value;
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('');
    if (v.result !== undefined) return v.result === null ? '' : v.result;
    if (v.text !== undefined) return v.text;
    if (v instanceof Date) return v;
  }
  return v;
}

function textoCelda(fila, col) {
  const v = valorCelda(fila, col);
  return v === null || v === undefined ? '' : String(v).trim();
}

// { ok, valor } — valor queda en null si la celda viene vacía (para aplicar
// el mismo default que usa el alta manual), o el número si trae algo. Si
// trae algo que no es un número válido, ok queda en false.
function numeroCelda(fila, col) {
  const texto = textoCelda(fila, col);
  if (texto === '') return { ok: true, valor: null };
  const n = Number(texto);
  if (Number.isNaN(n)) return { ok: false, valor: null };
  return { ok: true, valor: n };
}

function filaVacia(fila, totalColumnas) {
  for (let c = 1; c <= totalColumnas; c++) {
    if (textoCelda(fila, c) !== '') return false;
  }
  return true;
}

async function generarPlantillaCargaMasiva() {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ERP Desarmaduría';
  wb.created = new Date();

  const hojaInv = wb.addWorksheet(NOMBRE_HOJA_INVENTARIO);
  hojaInv.columns = COLUMNAS_INVENTARIO.map((c) => ({ header: c.titulo, width: c.ancho }));
  hojaInv.getRow(1).font = { bold: true };
  hojaInv.addRow(['', '', '', '', '', '', 'Amortiguador delantero derecho', 'Suspensión', '', 2, 1, 15000, 8000, 'Estante A-1']);
  hojaInv.addRow([3, '', '', '', '', '', 'Radiador', 'Motor', 'RAD-3', 1, 1, 45000, 25000, '']);
  hojaInv.addRow([10, 'Chevrolet', 'Corsa', 2015, 'Compra a particular', 'Vehículo chocado, motor sirve', 'Block motor', 'Motor', '', 1, 1, 80000, 50000, 'Estante A-2']);
  hojaInv.addRow([10, '', '', '', '', '', 'Culata', 'Motor', '', 1, 1, 60000, 30000, '']);
  hojaInv.getCell('A1').note =
    'Tres casos: (1) vacío = repuesto genérico, sin vehículo. (2) un N° que ya existe en el sistema = liga el repuesto a ese vehículo. (3) un N° que todavía NO existe, junto con Marca/Modelo/Año = crea ese vehículo nuevo con ese número exacto. Varias filas con el mismo N° nuevo se agrupan en un solo vehículo.';
  hojaInv.getCell('B1').note = 'Estos 5 campos (Marca a Observaciones) solo se usan cuando el N° de vehículo es NUEVO — se ignoran si el N° ya existe. Si varias filas comparten el mismo N° nuevo, basta con completarlos en una sola de ellas.';
  hojaInv.dataValidations.add('H2:H1000', {
    type: 'list',
    allowBlank: true,
    formulae: [`"${CATEGORIAS_REPUESTO.join(',')}"`],
  });

  const hojaBod = wb.addWorksheet(NOMBRE_HOJA_BODEGA);
  hojaBod.columns = COLUMNAS_BODEGA.map((c) => ({ header: c.titulo, width: c.ancho }));
  hojaBod.getRow(1).font = { bold: true };
  hojaBod.addRow(['Motor Corsa 2015', 'Block motor', 'Motor', '', 1, 1, 80000, 50000, '', '', 'Juan Pérez', 120000, 'Motor completo comprado para desarmar']);
  hojaBod.addRow(['Motor Corsa 2015', 'Culata', 'Motor', '', 1, 1, 60000, 30000, 'Estante B-2', 3, '', '', '']);
  hojaBod.getCell('A1').note =
    'Las filas con el mismo "Nombre de compra" se agrupan en una sola compra (igual que al ingresarla a mano en Bodega), numerada automáticamente.';
  hojaBod.getCell('K1').note = 'Proveedor, Costo total y Observaciones son datos de la compra completa: basta con escribirlos en una sola fila de cada grupo.';
  hojaBod.dataValidations.add('C2:C1000', {
    type: 'list',
    allowBlank: true,
    formulae: [`"${CATEGORIAS_REPUESTO.join(',')}"`],
  });

  const hojaAyuda = wb.addWorksheet('Instrucciones');
  hojaAyuda.columns = [{ width: 100 }];
  const lineas = [
    'CÓMO USAR ESTA PLANTILLA',
    '',
    'Hoja "Inventario": repuestos que salen de un vehículo desarmado, o genéricos (sin vehículo).',
    ' - "N° de vehículo" es opcional. Vacío = repuesto genérico. Un N° que ya existe = se liga a ese vehículo. Un N° que todavía no existe = crea ese vehículo nuevo (con Marca/Modelo/Año/Origen/Observaciones), con ese número exacto.',
    ' - Varias filas con el mismo N° de vehículo nuevo se agrupan en un solo vehículo — completa Marca/Modelo/Año/Origen/Observaciones en una sola de esas filas, no hace falta repetirlos.',
    ' - "Nombre" (del repuesto) es obligatorio.',
    ' - "Categoría" debe ser una de: ' + CATEGORIAS_REPUESTO.join(', ') + '. Si la dejas vacía, queda como "Otro".',
    ' - Los campos numéricos (cantidades, precio, costo) quedan en 0 (o 1 para "Cantidad mínima") si los dejas vacíos.',
    '',
    'Hoja "Inventario Bodega": repuestos de compra directa (no vienen de un vehículo).',
    ' - "Nombre de compra" es obligatorio: agrupa filas en una sola compra (ej: "Motor Corsa 2015"). Cada nombre distinto genera una compra nueva y numerada, igual que si la crearas a mano en Bodega.',
    ' - "Nombre" (del repuesto/pieza) es obligatorio.',
    ' - "Repisa" es opcional, pero si la completas debe ser el nombre exacto de una repisa ya creada en el sistema, y "Fila" debe estar dentro del rango de esa repisa.',
    ' - "Proveedor", "Costo total" y "Observaciones" son datos de la compra completa (no de cada pieza): escríbelos solo en una fila de cada grupo, no hace falta repetirlos en todas.',
    '',
    'No borres ni renombres las hojas "Inventario" e "Inventario Bodega": la carga masiva las busca por ese nombre exacto.',
    'Puedes borrar las filas de ejemplo antes de cargar tus datos reales.',
  ];
  lineas.forEach((l, i) => {
    hojaAyuda.getCell(`A${i + 1}`).value = l;
    if (i === 0) hojaAyuda.getCell(`A${i + 1}`).font = { bold: true, size: 13 };
  });

  return wb.xlsx.writeBuffer();
}

route(
  'GET',
  '/api/carga-masiva/plantilla',
  async (req, res, params, query, usuario) => {
    const buffer = await generarPlantillaCargaMasiva();
    res.writeHead(200, {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="plantilla-carga-masiva.xlsx"',
    });
    res.end(Buffer.from(buffer));
  },
  { roles: ['admin', 'mecanico_lider'] }
);

route(
  'POST',
  '/api/carga-masiva',
  async (req, res, params, query, usuario) => {
    const negocioId = usuario.negocio_id;
    const body = await readBody(req);
    if (!body.archivo || typeof body.archivo !== 'string') return sendError(res, 400, 'Falta el archivo Excel');
    const base64 = body.archivo.startsWith('data:') && body.archivo.includes(',') ? body.archivo.slice(body.archivo.indexOf(',') + 1) : body.archivo;
    const buffer = Buffer.from(base64, 'base64');

    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(buffer);
    } catch (e) {
      return sendError(res, 400, 'No se pudo leer el archivo: ¿es un Excel (.xlsx) válido?');
    }

    const hojaInv = wb.getWorksheet(NOMBRE_HOJA_INVENTARIO);
    const hojaBod = wb.getWorksheet(NOMBRE_HOJA_BODEGA);
    if (!hojaInv && !hojaBod) {
      return sendError(res, 400, `El archivo debe tener al menos una hoja llamada "${NOMBRE_HOJA_INVENTARIO}" o "${NOMBRE_HOJA_BODEGA}"`);
    }

    const errores = [];
    const vehiculosCache = new Map(); // numero -> vehiculo | null
    let repisasTodas = null; // se cargan una sola vez (no hay WHERE LOWER(nombre)=? en Firestore)

    async function obtenerVehiculoPorNumero(numero) {
      if (vehiculosCache.has(numero)) return vehiculosCache.get(numero);
      const v = await vehiculosDb.obtener(negocioId, numero);
      vehiculosCache.set(numero, v || null);
      return v || null;
    }

    async function obtenerRepisaPorNombre(nombre) {
      if (!repisasTodas) repisasTodas = await repisasDb.listarPorNegocio(negocioId);
      const clave = nombre.toLowerCase();
      return repisasTodas.find((r) => (r.nombre || '').toLowerCase() === clave) || null;
    }

    // ---------- Validar hoja Inventario ----------
    const filasInventario = [];
    // Vehículos nuevos a crear: agrupados por el N° que se les quiere dar,
    // igual que "Nombre de compra" agrupa piezas en Inventario Bodega.
    const gruposVehiculoNuevo = []; // { numero, marca, modelo, anio, origen, observaciones }
    const indiceGrupoVehiculoPorNumero = new Map();
    if (hojaInv) {
      for (let rn = 2; rn <= hojaInv.rowCount; rn++) {
        const fila = hojaInv.getRow(rn);
        if (filaVacia(fila, COLUMNAS_INVENTARIO.length)) continue;
        const etiquetaFila = `Hoja "${NOMBRE_HOJA_INVENTARIO}", fila ${rn}`;

        const numeroVehiculoTexto = textoCelda(fila, 1);
        const marcaTexto = textoCelda(fila, 2) || null;
        const modeloTexto = textoCelda(fila, 3) || null;
        const anioR = numeroCelda(fila, 4);
        if (!anioR.ok) {
          errores.push({ hoja: NOMBRE_HOJA_INVENTARIO, fila: rn, mensaje: `${etiquetaFila}: "Año" debe ser un número` });
          continue;
        }
        const origenTexto = textoCelda(fila, 5) || null;
        const obsVehiculoTexto = textoCelda(fila, 6) || null;
        const tieneDatosVehiculoNuevo = !!(marcaTexto || modeloTexto || anioR.valor !== null || origenTexto || obsVehiculoTexto);

        let vehiculoId = null;
        let grupoVehiculoNuevoIdx = null;

        if (numeroVehiculoTexto === '') {
          if (tieneDatosVehiculoNuevo) {
            errores.push({
              hoja: NOMBRE_HOJA_INVENTARIO,
              fila: rn,
              mensaje: `${etiquetaFila}: pusiste datos de un vehículo (marca/modelo/año/origen/observaciones) pero falta el "N° de vehículo"`,
            });
            continue;
          }
        } else {
          const numeroVehiculo = Number(numeroVehiculoTexto);
          if (!Number.isInteger(numeroVehiculo) || numeroVehiculo <= 0) {
            errores.push({ hoja: NOMBRE_HOJA_INVENTARIO, fila: rn, mensaje: `${etiquetaFila}: "N° de vehículo" debe ser un número entero positivo` });
            continue;
          }
          const vehiculoExistente = await obtenerVehiculoPorNumero(numeroVehiculo);
          if (vehiculoExistente) {
            vehiculoId = vehiculoExistente.id;
          } else {
            // N° nuevo: se crea un vehículo con ese número exacto. Varias
            // filas con el mismo N° nuevo se agrupan en un solo vehículo.
            let idx = indiceGrupoVehiculoPorNumero.get(numeroVehiculo);
            if (idx === undefined) {
              idx = gruposVehiculoNuevo.length;
              indiceGrupoVehiculoPorNumero.set(numeroVehiculo, idx);
              gruposVehiculoNuevo.push({ numero: numeroVehiculo, marca: null, modelo: null, anio: null, origen: null, observaciones: null });
            }
            const grupoV = gruposVehiculoNuevo[idx];
            if (grupoV.marca === null && marcaTexto) grupoV.marca = marcaTexto;
            if (grupoV.modelo === null && modeloTexto) grupoV.modelo = modeloTexto;
            if (grupoV.anio === null && anioR.valor !== null) grupoV.anio = anioR.valor;
            if (grupoV.origen === null && origenTexto) grupoV.origen = origenTexto;
            if (grupoV.observaciones === null && obsVehiculoTexto) grupoV.observaciones = obsVehiculoTexto;
            grupoVehiculoNuevoIdx = idx;
          }
        }

        const nombre = textoCelda(fila, 7);
        if (!nombre) {
          errores.push({ hoja: NOMBRE_HOJA_INVENTARIO, fila: rn, mensaje: `${etiquetaFila}: falta el nombre del repuesto` });
          continue;
        }

        const categoriaTexto = textoCelda(fila, 8);
        if (categoriaTexto && !CATEGORIAS_REPUESTO.includes(categoriaTexto)) {
          errores.push({
            hoja: NOMBRE_HOJA_INVENTARIO,
            fila: rn,
            mensaje: `${etiquetaFila}: "Categoría" debe ser una de: ${CATEGORIAS_REPUESTO.join(', ')} (o quedar vacía)`,
          });
          continue;
        }

        const codigo = textoCelda(fila, 9) || null;

        const numericos = {};
        let numericoInvalido = false;
        for (const [campo, col, etiqueta] of [
          ['cantidad_disponible', 10, 'Cantidad disponible'],
          ['cantidad_minima', 11, 'Cantidad mínima'],
          ['precio_venta', 12, 'Precio venta'],
          ['costo_unitario', 13, 'Costo unitario'],
        ]) {
          const r = numeroCelda(fila, col);
          if (!r.ok) {
            errores.push({ hoja: NOMBRE_HOJA_INVENTARIO, fila: rn, mensaje: `${etiquetaFila}: "${etiqueta}" debe ser un número` });
            numericoInvalido = true;
            break;
          }
          numericos[campo] = r.valor;
        }
        if (numericoInvalido) continue;

        const ubicacion = textoCelda(fila, 14) || null;

        filasInventario.push({
          vehiculo_id: vehiculoId,
          grupoVehiculoNuevoIdx,
          nombre,
          categoria: categoriaTexto || 'Otro',
          codigo,
          cantidad_disponible: numericos.cantidad_disponible ?? 0,
          cantidad_minima: numericos.cantidad_minima ?? 1,
          precio_venta: numericos.precio_venta ?? 0,
          costo_unitario: numericos.costo_unitario ?? 0,
          ubicacion,
        });
      }
    }

    // ---------- Validar hoja Inventario Bodega ----------
    const gruposCompra = []; // en orden de aparición: { nombre, proveedor, costo_total, observaciones, piezas: [...] }
    const indiceGrupoPorNombre = new Map();
    if (hojaBod) {
      for (let rn = 2; rn <= hojaBod.rowCount; rn++) {
        const fila = hojaBod.getRow(rn);
        if (filaVacia(fila, COLUMNAS_BODEGA.length)) continue;
        const etiquetaFila = `Hoja "${NOMBRE_HOJA_BODEGA}", fila ${rn}`;

        const nombreCompra = textoCelda(fila, 1);
        if (!nombreCompra) {
          errores.push({ hoja: NOMBRE_HOJA_BODEGA, fila: rn, mensaje: `${etiquetaFila}: falta el "Nombre de compra"` });
          continue;
        }

        const nombre = textoCelda(fila, 2);
        if (!nombre) {
          errores.push({ hoja: NOMBRE_HOJA_BODEGA, fila: rn, mensaje: `${etiquetaFila}: falta el nombre del repuesto` });
          continue;
        }

        const categoriaTexto = textoCelda(fila, 3);
        if (categoriaTexto && !CATEGORIAS_REPUESTO.includes(categoriaTexto)) {
          errores.push({
            hoja: NOMBRE_HOJA_BODEGA,
            fila: rn,
            mensaje: `${etiquetaFila}: "Categoría" debe ser una de: ${CATEGORIAS_REPUESTO.join(', ')} (o quedar vacía)`,
          });
          continue;
        }

        const codigo = textoCelda(fila, 4) || null;

        const numericos = {};
        let numericoInvalido = false;
        for (const [campo, col, etiqueta] of [
          ['cantidad_disponible', 5, 'Cantidad disponible'],
          ['cantidad_minima', 6, 'Cantidad mínima'],
          ['precio_venta', 7, 'Precio venta'],
          ['costo_unitario', 8, 'Costo unitario'],
        ]) {
          const r = numeroCelda(fila, col);
          if (!r.ok) {
            errores.push({ hoja: NOMBRE_HOJA_BODEGA, fila: rn, mensaje: `${etiquetaFila}: "${etiqueta}" debe ser un número` });
            numericoInvalido = true;
            break;
          }
          numericos[campo] = r.valor;
        }
        if (numericoInvalido) continue;

        const nombreRepisa = textoCelda(fila, 9);
        let repisaId = null;
        let filaAsignada = null;
        if (nombreRepisa) {
          const repisa = await obtenerRepisaPorNombre(nombreRepisa);
          if (!repisa) {
            errores.push({ hoja: NOMBRE_HOJA_BODEGA, fila: rn, mensaje: `${etiquetaFila}: no existe una repisa llamada "${nombreRepisa}"` });
            continue;
          }
          const filaR = numeroCelda(fila, 10);
          if (!filaR.ok) {
            errores.push({ hoja: NOMBRE_HOJA_BODEGA, fila: rn, mensaje: `${etiquetaFila}: "Fila" debe ser un número` });
            continue;
          }
          const filaNum = filaR.valor ?? 1;
          if (filaNum < 1 || filaNum > repisa.cantidad_filas) {
            errores.push({
              hoja: NOMBRE_HOJA_BODEGA,
              fila: rn,
              mensaje: `${etiquetaFila}: "Fila" debe estar entre 1 y ${repisa.cantidad_filas} para la repisa "${repisa.nombre}"`,
            });
            continue;
          }
          repisaId = repisa.id;
          filaAsignada = filaNum;
        }

        const proveedor = textoCelda(fila, 11) || null;
        const costoTotalR = numeroCelda(fila, 12);
        if (!costoTotalR.ok) {
          errores.push({ hoja: NOMBRE_HOJA_BODEGA, fila: rn, mensaje: `${etiquetaFila}: "Costo total" debe ser un número` });
          continue;
        }
        const observaciones = textoCelda(fila, 13) || null;

        let idxGrupo = indiceGrupoPorNombre.get(nombreCompra);
        if (idxGrupo === undefined) {
          idxGrupo = gruposCompra.length;
          indiceGrupoPorNombre.set(nombreCompra, idxGrupo);
          gruposCompra.push({ nombre: nombreCompra, proveedor: null, costo_total: null, observaciones: null, piezas: [] });
        }
        const grupo = gruposCompra[idxGrupo];
        if (grupo.proveedor === null && proveedor) grupo.proveedor = proveedor;
        if (grupo.costo_total === null && costoTotalR.valor !== null) grupo.costo_total = costoTotalR.valor;
        if (grupo.observaciones === null && observaciones) grupo.observaciones = observaciones;

        grupo.piezas.push({
          nombre,
          categoria: categoriaTexto || 'Otro',
          codigo,
          cantidad_disponible: numericos.cantidad_disponible ?? 0,
          cantidad_minima: numericos.cantidad_minima ?? 1,
          precio_venta: numericos.precio_venta ?? 0,
          costo_unitario: numericos.costo_unitario ?? 0,
          repisa_id: repisaId,
          fila: filaAsignada,
        });
      }
    }

    if (errores.length) {
      return sendJson(res, 400, {
        error: `Se encontraron ${errores.length} error(es) en el archivo. No se guardó nada — corrígelos y vuelve a intentar.`,
        errores,
      });
    }

    if (!filasInventario.length && !gruposCompra.length) {
      return sendError(res, 400, 'El archivo no tiene filas con datos para cargar');
    }

    // ---------- Todo válido: recién ahora se escribe en Firestore ----------
    // Primero los vehículos nuevos (si los hay), para poder ligarles después
    // sus repuestos — mismo set() que usa la creación manual de vehículos
    // (db/vehiculos.js: el id del documento es el propio número).
    let creadosVehiculos = 0;
    const idVehiculoNuevoPorIdx = new Map();
    for (let i = 0; i < gruposVehiculoNuevo.length; i++) {
      const gv = gruposVehiculoNuevo[i];
      await vehiculosDb.crear(negocioId, gv.numero, {
        patente: null,
        marca: gv.marca,
        modelo: gv.modelo,
        anio: gv.anio,
        color: null,
        kilometraje: null,
        estado: 'en_desarme',
        origen: gv.origen,
        observaciones: gv.observaciones,
        costo_compra: 0,
        valor_motor_referencia: 0,
        fecha_ingreso: ahora(),
      });
      idVehiculoNuevoPorIdx.set(i, String(gv.numero));
      creadosVehiculos++;
    }

    let creadosInventario = 0;
    for (const f of filasInventario) {
      const vehiculoIdFinal = f.grupoVehiculoNuevoIdx !== null ? idVehiculoNuevoPorIdx.get(f.grupoVehiculoNuevoIdx) : f.vehiculo_id;
      await inventarioDb.crear(negocioId, {
        vehiculo_id: vehiculoIdFinal,
        codigo: f.codigo,
        nombre: f.nombre,
        categoria: f.categoria,
        cantidad_disponible: f.cantidad_disponible,
        cantidad_minima: f.cantidad_minima,
        precio_venta: f.precio_venta,
        costo_unitario: f.costo_unitario,
        ubicacion: f.ubicacion,
        fecha_ingreso: ahora(),
        activo: 1,
      });
      creadosInventario++;
    }

    let creadosCompras = 0;
    let creadosPiezas = 0;
    if (gruposCompra.length) {
      let siguienteNumero = await bodegaDb.siguienteNumeroCompra(negocioId);
      for (const grupo of gruposCompra) {
        const numero = siguienteNumero++;
        await bodegaDb.crearCompra(negocioId, numero, {
          nombre: grupo.nombre,
          proveedor: grupo.proveedor,
          costo_total: grupo.costo_total || 0,
          observaciones: grupo.observaciones,
          fecha_ingreso: ahora(),
        });
        creadosCompras++;
        for (const p of grupo.piezas) {
          await bodegaDb.crearPieza(negocioId, {
            compra_id: String(numero),
            codigo: p.codigo,
            nombre: p.nombre,
            categoria: p.categoria,
            cantidad_disponible: p.cantidad_disponible,
            cantidad_minima: p.cantidad_minima,
            precio_venta: p.precio_venta,
            costo_unitario: p.costo_unitario,
            repisa_id: p.repisa_id,
            fila: p.fila,
            fecha_ingreso: ahora(),
            activo: 1,
          });
          creadosPiezas++;
        }
      }
    }

    await registrarAuditoria(usuario, {
      accion: 'carga_masiva',
      entidad_tipo: 'carga_masiva',
      entidad_id: null,
      detalle: `Hizo una carga masiva por Excel: ${creadosVehiculos} vehículo(s) nuevo(s), ${creadosInventario} repuesto(s) en Inventario, ${creadosCompras} compra(s) nueva(s) en Bodega con ${creadosPiezas} pieza(s).`,
    });

    sendJson(res, 200, {
      ok: true,
      creados_vehiculos: creadosVehiculos,
      creados_inventario: creadosInventario,
      creadas_compras_bodega: creadosCompras,
      creadas_piezas_bodega: creadosPiezas,
    });
  },
  { roles: ['admin', 'mecanico_lider'] }
);

// ==================== REPORTES (solo admin) ====================
//
// El panel de ventas (dashboard.html) puede filtrar por "rango" (querystring
// ?rango=mes|3m|anio, o sin parámetro / "todo" para el historial completo).
// calcularRango() traduce eso a fechas ISO límite — idéntico al original,
// función pura que no toca la base de datos.
function calcularRango(rango) {
  const ahoraD = new Date();
  if (rango === 'mes') {
    const desdeActual = new Date(Date.UTC(ahoraD.getUTCFullYear(), ahoraD.getUTCMonth(), 1)).toISOString();
    const desdePrevio = new Date(Date.UTC(ahoraD.getUTCFullYear(), ahoraD.getUTCMonth() - 1, 1)).toISOString();
    return { desdeActual, desdePrevio, hastaPrevio: desdeActual };
  }
  if (rango === '3m') {
    const desdeActual = new Date(ahoraD.getTime() - 90 * 24 * 3600 * 1000).toISOString();
    const desdePrevio = new Date(ahoraD.getTime() - 180 * 24 * 3600 * 1000).toISOString();
    return { desdeActual, desdePrevio, hastaPrevio: desdeActual };
  }
  if (rango === 'anio') {
    const desdeActual = new Date(Date.UTC(ahoraD.getUTCFullYear(), 0, 1)).toISOString();
    const desdePrevio = new Date(Date.UTC(ahoraD.getUTCFullYear() - 1, 0, 1)).toISOString();
    return { desdeActual, desdePrevio, hastaPrevio: desdeActual };
  }
  return { desdeActual: null, desdePrevio: null, hastaPrevio: null }; // 'todo' (por defecto)
}

// Trae TODAS las ventas completadas del negocio (sin el tope de 300 que usa
// la vista de lista — ver db/ventas.js), opcionalmente desde una fecha.
async function ventasCompletadasDesde(negocioId, desde) {
  const todas = await ventasDb.listarTodasPorNegocio(negocioId, desde ? { desde } : {});
  return todas.filter((v) => v.estado === 'completada');
}

route(
  'GET',
  '/api/reportes/resumen',
  async (req, res, params, query, usuario) => {
    const negocioId = usuario.negocio_id;
    const { desdeActual, desdePrevio, hastaPrevio } = calcularRango(query.get('rango'));

    const ventasActuales = await ventasCompletadasDesde(negocioId, desdeActual);
    const totalVentas = ventasActuales.length;
    const montoTotal = ventasActuales.reduce((acc, v) => acc + (v.total || 0), 0);

    let comparacion = null;
    if (desdePrevio) {
      const todasHastaAhora = await ventasDb.listarTodasPorNegocio(negocioId, { desde: desdePrevio });
      const montoPrevio = todasHastaAhora
        .filter((v) => v.estado === 'completada' && v.fecha >= desdePrevio && v.fecha < hastaPrevio)
        .reduce((acc, v) => acc + (v.total || 0), 0);
      if (montoPrevio > 0) {
        comparacion = { porcentaje: Math.round(((montoTotal - montoPrevio) / montoPrevio) * 1000) / 10, subida: montoTotal >= montoPrevio };
      } else if (montoTotal > 0) {
        comparacion = { porcentaje: 100, subida: true };
      }
    }

    const hoy = ahora().slice(0, 10);
    const todasLasVentas = await ventasDb.listarTodasPorNegocio(negocioId, {});
    const ventasHoy = todasLasVentas.filter((v) => v.estado === 'completada' && (v.fecha || '').startsWith(hoy)).length;

    const inventario = await inventarioDb.listarPorNegocio(negocioId);
    const inventarioActivo = inventario.filter((i) => Number(i.activo));
    const bajoStock = inventarioActivo.filter((i) => i.cantidad_disponible <= i.cantidad_minima).length;
    const totalRepuestos = inventarioActivo.length;
    // Ganancia total de vehículos: suma del valor de venta de todos los
    // repuestos DISPONIBLES que salieron de vehículos (Inventario, no
    // Inventario Bodega) — cantidad_disponible × precio_venta de cada uno,
    // no lo ya vendido. Es el valor total que representa el stock actual.
    const gananciaTotalVehiculos = inventarioActivo.reduce((acc, i) => acc + (i.cantidad_disponible || 0) * (i.precio_venta || 0), 0);

    const vehiculos = await vehiculosDb.listarPorNegocio(negocioId);
    const vehiculosEnDesarme = vehiculos.filter((v) => v.estado === 'en_desarme').length;
    // Costo total de vehículos: suma de lo que costó comprar cada vehículo
    // ingresado (campo cargado al registrar el vehículo, editable después).
    const costoTotalVehiculos = vehiculos.reduce((acc, v) => acc + (v.costo_compra || 0), 0);

    sendJson(res, 200, { totalVentas, montoTotal, ventasHoy, bajoStock, vehiculosEnDesarme, totalRepuestos, costoTotalVehiculos, gananciaTotalVehiculos, comparacion });
  },
  { roles: ['admin'] }
);

route(
  'GET',
  '/api/reportes/ventas-por-mes',
  async (req, res, params, query, usuario) => {
    // El mes se calcula recortando el ISO string (los primeros 7 caracteres de
    // "2026-08-30T..." son "2026-08") — idéntico al original.
    const ventas = await ventasCompletadasDesde(usuario.negocio_id, null);
    const porMes = new Map();
    for (const v of ventas) {
      const mes = v.fecha.slice(0, 7);
      if (!porMes.has(mes)) porMes.set(mes, { mes, total: 0, cantidad: 0 });
      const acc = porMes.get(mes);
      acc.total += v.total;
      acc.cantidad += 1;
    }
    const data = Array.from(porMes.values()).sort((a, b) => a.mes.localeCompare(b.mes));
    sendJson(res, 200, data);
  },
  { roles: ['admin'] }
);

// Los ítems de cada venta van embebidos (ver db/ventas.js) — "aplanarlos"
// acá reemplaza el JOIN venta_items + ventas de la versión SQL.
function itemsDeVentas(ventas) {
  const items = [];
  for (const v of ventas) {
    for (const it of v.items || []) items.push({ ...it, venta: v });
  }
  return items;
}

route(
  'GET',
  '/api/reportes/ventas-por-categoria',
  async (req, res, params, query, usuario) => {
    const { desdeActual } = calcularRango(query.get('rango'));
    const ventas = await ventasCompletadasDesde(usuario.negocio_id, desdeActual);
    const porCategoria = new Map();
    for (const it of itemsDeVentas(ventas)) {
      const cat = it.categoria || 'Otro';
      if (!porCategoria.has(cat)) porCategoria.set(cat, { categoria: cat, cantidad: 0, monto_total: 0 });
      const acc = porCategoria.get(cat);
      acc.cantidad += it.cantidad;
      acc.monto_total += it.cantidad * it.precio_unitario;
    }
    const data = Array.from(porCategoria.values()).sort((a, b) => b.monto_total - a.monto_total);
    sendJson(res, 200, data);
  },
  { roles: ['admin'] }
);

route(
  'GET',
  '/api/reportes/ventas-por-tipo-pago',
  async (req, res, params, query, usuario) => {
    const { desdeActual } = calcularRango(query.get('rango'));
    const ventas = await ventasCompletadasDesde(usuario.negocio_id, desdeActual);
    const porTipo = new Map();
    for (const v of ventas) {
      if (!porTipo.has(v.tipo_pago)) porTipo.set(v.tipo_pago, { tipo_pago: v.tipo_pago, cantidad: 0, monto_total: 0 });
      const acc = porTipo.get(v.tipo_pago);
      acc.cantidad += 1;
      acc.monto_total += v.total || 0;
    }
    const data = Array.from(porTipo.values()).sort((a, b) => b.monto_total - a.monto_total);
    sendJson(res, 200, data);
  },
  { roles: ['admin'] }
);

route(
  'GET',
  '/api/reportes/top-repuestos',
  async (req, res, params, query, usuario) => {
    const { desdeActual } = calcularRango(query.get('rango'));
    const ventas = await ventasCompletadasDesde(usuario.negocio_id, desdeActual);
    const porNombre = new Map();
    for (const it of itemsDeVentas(ventas)) {
      if (!porNombre.has(it.nombre_repuesto)) porNombre.set(it.nombre_repuesto, { nombre_repuesto: it.nombre_repuesto, cantidad: 0, monto_total: 0 });
      const acc = porNombre.get(it.nombre_repuesto);
      acc.cantidad += it.cantidad;
      acc.monto_total += it.cantidad * it.precio_unitario;
    }
    const data = Array.from(porNombre.values())
      .sort((a, b) => b.cantidad - a.cantidad)
      .slice(0, 10);
    sendJson(res, 200, data);
  },
  { roles: ['admin'] }
);

// ==================== TRAZABILIDAD (solo admin) ====================
//
// Dos vistas complementarias para que el administrador tenga trazabilidad
// total de lo que pasa en su negocio:
//
//  - /api/reportes/ventas-detalle: cada ítem vendido por separado (quién lo
//    vendió, a qué precio, a qué cliente, y de qué vehículo salió si aplica).
//  - /api/auditoria: la bitácora de acciones sensibles (ventas anuladas,
//    repuestos editados, usuarios creados/modificados, etc.), ver db/auditoria.js.
//
// Ambas aceptan ?formato=csv para descargar exactamente lo mismo que se ve
// en pantalla, en un archivo que Excel abre directamente.

route(
  'GET',
  '/api/reportes/ventas-detalle',
  async (req, res, params, query, usuario) => {
    const negocioId = usuario.negocio_id;
    // A diferencia de los reportes de arriba, acá se listan TODAS las ventas
    // (no solo "completada") — igual que el original, que no filtraba por
    // estado en esta vista, para poder ver también lo anulado.
    let ventas = await ventasDb.listarTodasPorNegocio(negocioId, {
      desde: query.get('desde') || undefined,
      hasta: query.get('hasta') || undefined,
    });
    if (query.get('usuario_id')) ventas = ventas.filter((v) => String(v.usuario) === String(query.get('usuario_id')));

    let filas = [];
    for (const v of ventas) {
      for (const it of v.items || []) {
        const itEnriquecido = await enriquecerItemVenta(it, usuario);
        filas.push({ venta: v, item: itEnriquecido });
      }
    }
    if (query.get('categoria')) filas = filas.filter((f) => f.item.categoria === query.get('categoria'));
    if (query.get('q')) {
      const qLower = query.get('q').toLowerCase();
      filas = filas.filter((f) => (f.item.nombre_repuesto || '').toLowerCase().includes(qLower));
    }
    filas.sort((a, b) => (a.venta.fecha < b.venta.fecha ? 1 : -1));
    filas = filas.slice(0, 1000);

    // vendedor_nombre: una búsqueda por cada usuario distinto, no por fila.
    const nombrePorUsuario = new Map();
    async function vendedorNombre(usernameVendedor) {
      if (!nombrePorUsuario.has(usernameVendedor)) {
        const u = await usuariosDb.obtenerPorUsername(usernameVendedor);
        nombrePorUsuario.set(usernameVendedor, u ? u.nombre : usernameVendedor);
      }
      return nombrePorUsuario.get(usernameVendedor);
    }

    const data = [];
    for (const f of filas) {
      const { venta: v, item: it } = f;
      data.push({
        venta_id: v.id,
        fecha: v.fecha,
        vendedor_nombre: await vendedorNombre(v.usuario),
        vendedor_id: v.usuario,
        cliente_nombre: v.cliente_nombre,
        cliente_telefono: v.cliente_telefono,
        tipo_pago: v.tipo_pago,
        estado: v.estado,
        nombre_repuesto: it.nombre_repuesto,
        categoria: it.categoria,
        cantidad: it.cantidad,
        precio_unitario: it.precio_unitario,
        origen: it.origen,
        subtotal: it.cantidad * it.precio_unitario,
        vehiculo_numero: it.vehiculo_numero ?? null,
        vehiculo_patente: it.vehiculo_patente ?? null,
        vehiculo_marca: it.vehiculo_marca ?? null,
        vehiculo_modelo: it.vehiculo_modelo ?? null,
        bodega_numero: it.bodega_numero ?? null,
        bodega_compra_nombre: it.bodega_compra_nombre ?? null,
      });
    }

    if (query.get('formato') === 'csv') {
      const csv = aCsv(data, [
        { titulo: 'Venta #', valor: (f) => f.venta_id },
        { titulo: 'Fecha', valor: (f) => f.fecha },
        { titulo: 'Vendedor', valor: (f) => f.vendedor_nombre },
        { titulo: 'Repuesto', valor: (f) => f.nombre_repuesto },
        { titulo: 'Categoría', valor: (f) => f.categoria },
        { titulo: 'Cantidad', valor: (f) => f.cantidad },
        { titulo: 'Precio unitario', valor: (f) => f.precio_unitario },
        { titulo: 'Subtotal', valor: (f) => f.subtotal },
        {
          titulo: 'Origen',
          valor: (f) =>
            f.origen === 'bodega'
              ? `Inventario Bodega — N°${f.bodega_numero ?? '—'} (${f.bodega_compra_nombre || ''})`
              : f.vehiculo_numero != null
                ? `${f.vehiculo_patente || `Vehículo ${f.vehiculo_numero}`} (${[f.vehiculo_marca, f.vehiculo_modelo].filter(Boolean).join(' ')})`
                : 'Genérico',
        },
        { titulo: 'Cliente', valor: (f) => f.cliente_nombre },
        { titulo: 'Teléfono cliente', valor: (f) => f.cliente_telefono },
        { titulo: 'Tipo de pago', valor: (f) => f.tipo_pago },
        { titulo: 'Estado', valor: (f) => f.estado },
      ]);
      return sendCsv(res, `ventas-detalle-${ahora().slice(0, 10)}.csv`, csv);
    }
    sendJson(res, 200, data);
  },
  { roles: ['admin'] }
);

route(
  'GET',
  '/api/auditoria',
  async (req, res, params, query, usuario) => {
    let data = await auditoriaDb.listarPorNegocio(usuario.negocio_id);
    if (query.get('usuario_id')) data = data.filter((f) => String(f.usuario) === String(query.get('usuario_id')));
    if (query.get('accion')) data = data.filter((f) => f.accion === query.get('accion'));
    if (query.get('desde')) data = data.filter((f) => f.fecha >= query.get('desde'));
    if (query.get('hasta')) data = data.filter((f) => f.fecha <= query.get('hasta'));
    data = data.slice(0, 1000);

    if (query.get('formato') === 'csv') {
      const csv = aCsv(data, [
        { titulo: 'Fecha', valor: (f) => f.fecha },
        { titulo: 'Usuario', valor: (f) => f.usuario_nombre },
        { titulo: 'Rol', valor: (f) => ROL_LABEL_AUDITORIA[f.rol] || f.rol },
        { titulo: 'Acción', valor: (f) => ACCIONES_AUDITORIA[f.accion] || f.accion },
        { titulo: 'Detalle', valor: (f) => f.detalle },
      ]);
      return sendCsv(res, `bitacora-auditoria-${ahora().slice(0, 10)}.csv`, csv);
    }
    sendJson(res, 200, data);
  },
  { roles: ['admin'] }
);

// ==================== MARKETPLACE ENTRE NEGOCIOS ====================
// Deliberadamente cruza negocios (a diferencia de todo lo de arriba). Solo
// expone lo mínimo para que un negocio decida si le conviene contactar a
// otro: nombre del repuesto, categoría, cuánto tienen y el nombre del
// negocio — nunca el detalle completo de su inventario ni sus ventas.

route(
  'GET',
  '/api/marketplace/buscar',
  async (req, res, params, query, usuario) => {
    const data = await marketplaceDb.buscarRepuestos(usuario.negocio_id, { q: query.get('q'), categoria: query.get('categoria') });
    sendJson(res, 200, data);
  },
  { roles: ['admin', 'mecanico_lider', 'vendedor'] }
);

route(
  'GET',
  '/api/marketplace/negocios',
  async (req, res, params, query, usuario) => {
    sendJson(res, 200, await marketplaceDb.listarOtrosNegocios(usuario.negocio_id));
  },
  { roles: ['admin', 'mecanico_lider', 'vendedor'] }
);

// ==================== CHAT ENTRE NEGOCIOS ====================

route(
  'GET',
  '/api/chat/conversaciones',
  async (req, res, params, query, usuario) => {
    const negocioId = usuario.negocio_id;
    const conversaciones = await chatDb.listarPorNegocio(negocioId);
    for (const c of conversaciones) {
      const otroId = String(c.negocio_a_id) === String(negocioId) ? c.negocio_b_id : c.negocio_a_id;
      c.otro_negocio_id = otroId;
      const otro = await negociosDb.obtenerPorId(otroId);
      c.otro_negocio_nombre = otro ? otro.nombre : 'Negocio eliminado';
      const mensajes = await chatDb.listarMensajes(c.id);
      c.ultimo_mensaje = mensajes.length ? mensajes[mensajes.length - 1] : null;
      c.no_leidos = mensajes.filter((m) => !m.leido && String(m.negocio_emisor_id) !== String(negocioId)).length;
    }
    sendJson(res, 200, conversaciones);
  },
  { roles: ['admin', 'mecanico_lider', 'vendedor'] }
);

route(
  'POST',
  '/api/chat/conversaciones',
  async (req, res, params, query, usuario) => {
    const body = await readBody(req);
    const otroNegocioId = body.negocio_id;
    if (!otroNegocioId || String(otroNegocioId) === String(usuario.negocio_id)) return sendError(res, 400, 'Negocio inválido');
    const otro = await negociosDb.obtenerPorId(otroNegocioId);
    if (!otro || !otro.activo) return sendError(res, 404, 'Negocio no encontrado');
    const conversacion = await chatDb.obtenerOCrear(usuario.negocio_id, otroNegocioId, ahora);
    sendJson(res, 200, { id: conversacion.id, otro_negocio_id: otroNegocioId, otro_negocio_nombre: otro.nombre });
  },
  { roles: ['admin', 'mecanico_lider', 'vendedor'] }
);

async function validarAccesoConversacion(conversacionId, negocioId) {
  const c = await chatDb.obtener(conversacionId);
  if (!c) return null;
  if (String(c.negocio_a_id) !== String(negocioId) && String(c.negocio_b_id) !== String(negocioId)) return null;
  return c;
}

route(
  'GET',
  '/api/chat/conversaciones/:id/mensajes',
  async (req, res, params, query, usuario) => {
    const conversacion = await validarAccesoConversacion(params.id, usuario.negocio_id);
    if (!conversacion) return sendError(res, 404, 'Conversación no encontrada');
    const mensajes = await chatDb.listarMensajes(params.id);
    await chatDb.marcarLeidos(params.id, usuario.negocio_id);
    sendJson(res, 200, mensajes);
  },
  { roles: ['admin', 'mecanico_lider', 'vendedor'] }
);

route(
  'POST',
  '/api/chat/conversaciones/:id/mensajes',
  async (req, res, params, query, usuario) => {
    const body = await readBody(req);
    if (!body.mensaje || !body.mensaje.trim()) return sendError(res, 400, 'El mensaje no puede estar vacío');
    const conversacion = await validarAccesoConversacion(params.id, usuario.negocio_id);
    if (!conversacion) return sendError(res, 404, 'Conversación no encontrada');
    const datosMensaje = { negocio_emisor_id: usuario.negocio_id, usuario: usuario.usuario, mensaje: body.mensaje.trim(), enviado_en: ahora(), leido: false };
    const mensajeId = await chatDb.crearMensaje(params.id, datosMensaje);
    await chatDb.actualizarUltimoMensaje(params.id, datosMensaje.enviado_en);
    sendJson(res, 201, { id: mensajeId, ...datosMensaje });
  },
  { roles: ['admin', 'mecanico_lider', 'vendedor'] }
);

// ==================== Servidor HTTP (idéntico al original) ====================

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = decodeURIComponent(url.pathname);

    if (!pathname.startsWith('/api/')) {
      const usuario = await obtenerUsuarioDeSesion(req);
      return servirEstatico(req, res, usuario, pathname);
    }

    const segmentosPath = pathname.split('/').filter(Boolean);
    const candidata = rutas.find((r) => r.metodo === req.method && emparejar(r.segmentos, segmentosPath));
    if (!candidata) return sendError(res, 404, 'Ruta no encontrada');

    const params = emparejar(candidata.segmentos, segmentosPath) || {};
    const usuario = await obtenerUsuarioDeSesion(req);

    if (!candidata.opts.publico && !usuario) return sendError(res, 401, 'Debes iniciar sesión');
    if (candidata.opts.roles && usuario && !candidata.opts.roles.includes(usuario.rol)) {
      return sendError(res, 403, 'No tienes permiso para esto');
    }

    await candidata.handler(req, res, params, url.searchParams, usuario);
  } catch (e) {
    console.error('Error en la solicitud:', e);
    if (!res.headersSent) sendError(res, 500, e.message || 'Error interno del servidor');
  }
});

// ---- Arranque: quién inyecta la conexión real a Firestore vive en index.js
// (producción) o en las pruebas (Firestore falso) — este archivo no decide
// eso, solo expone iniciar(conexionFirestore).
async function iniciar(conexionFirestore, fieldValue) {
  db = conexionFirestore;
  FieldValue = fieldValue;
  negociosDb = crearNegociosDb(db);
  usuariosDb = crearUsuariosDb(db);
  auditoriaDb = crearAuditoriaDb(db, ahora);
  vehiculosDb = crearVehiculosDb(db);
  inventarioDb = crearInventarioDb(db);
  catalogoDb = crearCatalogoDb(db);
  bodegaDb = crearBodegaDb(db);
  repisasDb = crearRepisasDb(db, bodegaDb);
  ventasDb = crearVentasDb(db);
  tallerDb = crearTallerDb(db);
  marketplaceDb = crearMarketplaceDb(db, negociosDb);
  chatDb = crearChatDb(db);
  claveCifradoPass = await usuariosDb.obtenerClaveCifrado();
  return new Promise((resolve) => {
    server.listen(PUERTO, () => {
      console.log('\nERP de Desarmaduría (Firestore)');
      console.log(`Servidor corriendo en http://localhost:${PUERTO}`);
      resolve(server);
    });
  });
}

module.exports = { iniciar, server };
