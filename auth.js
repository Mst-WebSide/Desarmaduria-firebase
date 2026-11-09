// Contraseñas y sesiones. Mismo enfoque simple usado en el proyecto del
// taller de camiones: scrypt con sal propia por usuario (sin dependencias
// externas — usa el módulo "crypto" incluido en Node.js) y un token de
// sesión aleatorio guardado en la tabla "sesiones", enviado al navegador
// como cookie httpOnly.
const crypto = require('crypto');

const DURACION_SESION_MS = 1000 * 60 * 60 * 24 * 30; // 30 días

function hashPassword(password, saltExistente) {
  const salt = saltExistente || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

function verificarPassword(password, salt, hashGuardado) {
  const { hash } = hashPassword(password, salt);
  const bufA = Buffer.from(hash, 'hex');
  const bufB = Buffer.from(hashGuardado, 'hex');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function generarToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Guardado reversible de la contraseña actual de cada usuario (aparte del
// hash de arriba, que es el que realmente se usa para validar el login y no
// se puede revertir). Esto es SOLO para que un administrador pueda ver la
// contraseña vigente de alguien desde Administración — ver el candado de
// intentos en server.js (ver-password / desbloquear-ver-password) y el aviso
// de seguridad en el README. AES-256-GCM con una clave que se genera una
// sola vez y se guarda en la tabla config_app (ver db/index.js).
function cifrarTexto(texto, claveHex) {
  const clave = Buffer.from(claveHex, 'hex');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', clave, iv);
  const cifrado = Buffer.concat([cipher.update(texto, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString('hex'), authTag.toString('hex'), cifrado.toString('hex')].join(':');
}

function descifrarTexto(valorGuardado, claveHex) {
  if (!valorGuardado) return null;
  const partes = valorGuardado.split(':');
  if (partes.length !== 3) return null;
  const [ivHex, authTagHex, cifradoHex] = partes;
  try {
    const clave = Buffer.from(claveHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', clave, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    const texto = Buffer.concat([decipher.update(Buffer.from(cifradoHex, 'hex')), decipher.final()]);
    return texto.toString('utf8');
  } catch (e) {
    return null; // clave de cifrado distinta o dato corrupto -> no se puede mostrar
  }
}

function normalizarUsuario(nombre) {
  const sinTildes = nombre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
  const partes = sinTildes.trim().split(/\s+/);
  const primerNombre = partes[0] || 'usuario';
  const apellido = partes.length > 1 ? partes[partes.length - 1] : '';
  return (primerNombre[0] + apellido).replace(/[^a-z0-9]/g, '') || primerNombre;
}

function leerCookie(req, nombre) {
  const cabecera = req.headers.cookie;
  if (!cabecera) return null;
  const partes = cabecera.split(';').map((p) => p.trim());
  for (const parte of partes) {
    const igual = parte.indexOf('=');
    if (igual === -1) continue;
    if (parte.slice(0, igual) === nombre) return decodeURIComponent(parte.slice(igual + 1));
  }
  return null;
}

function fijarCookieSesion(res, token) {
  const expira = new Date(Date.now() + DURACION_SESION_MS).toUTCString();
  res.setHeader('Set-Cookie', `sesion=${token}; Path=/; HttpOnly; SameSite=Lax; Expires=${expira}`);
}

function borrarCookieSesion(res) {
  res.setHeader('Set-Cookie', 'sesion=; Path=/; HttpOnly; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT');
}

module.exports = {
  DURACION_SESION_MS,
  hashPassword,
  verificarPassword,
  generarToken,
  normalizarUsuario,
  leerCookie,
  fijarCookieSesion,
  borrarCookieSesion,
  cifrarTexto,
  descifrarTexto,
};
