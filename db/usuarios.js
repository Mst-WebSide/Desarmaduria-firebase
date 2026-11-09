// Acceso a /usuarios, /sesiones y /config_app en Firestore.
//
// Decisión de diseño: el documento de cada usuario usa como ID el propio
// nombre de usuario (en vez de un id numérico autoincremental como en SQL).
// Como "usuario" ya era UNIQUE en el esquema SQL, esto no pierde nada, y
// permite loguearse con un solo .doc(usuario).get() en vez de una consulta
// — además simplifica sesiones (guardan directo el username, no un id
// separado). Todo lo demás (negocio_id, rol, password_hash...) es igual.
//
// El campo "id" que devuelven estas funciones es ese mismo username — el
// resto del backend y el frontend lo tratan como un identificador opaco, así
// que no hace falta ningún cambio en las pantallas por este cambio de tipo
// (antes era un número, ahora es un texto).
const crypto = require('crypto');

function crearUsuariosDb(db) {
  const usuariosCol = () => db.collection('usuarios');
  const sesionesCol = () => db.collection('sesiones');
  const configCol = () => db.collection('config_app');

  function filaDesdeSnap(snap) {
    if (!snap.exists) return null;
    return { id: snap.id, usuario: snap.id, ...snap.data() };
  }

  return {
    async obtenerPorUsername(usuario) {
      const snap = await usuariosCol().doc(usuario).get();
      return filaDesdeSnap(snap);
    },

    async listarPorNegocio(negocioId) {
      const snap = await usuariosCol().where('negocio_id', '==', negocioId).get();
      return snap.docs.map((d) => filaDesdeSnap(d)).sort((a, b) => a.nombre.localeCompare(b.nombre));
    },

    async nombreDeUsuarioDisponible(usuario) {
      const snap = await usuariosCol().doc(usuario).get();
      return !snap.exists;
    },

    async crear(usuario, datos) {
      await usuariosCol().doc(usuario).set(datos);
      return usuario; // "id" del nuevo usuario = su propio username
    },

    async actualizar(usuario, cambios) {
      await usuariosCol().doc(usuario).update(cambios);
    },

    // ---- sesiones ----
    async crearSesion(token, datos) {
      await sesionesCol().doc(token).set(datos);
    },
    async obtenerSesion(token) {
      const snap = await sesionesCol().doc(token).get();
      return snap.exists ? snap.data() : null;
    },
    async borrarSesion(token) {
      await sesionesCol().doc(token).delete();
    },

    // ---- config_app: clave de cifrado de password_plana ----
    async obtenerClaveCifrado() {
      const snap = await configCol().doc('clave_cifrado_pass').get();
      if (snap.exists) return snap.data().valor;
      const nueva = crypto.randomBytes(32).toString('hex');
      await configCol().doc('clave_cifrado_pass').set({ valor: nueva });
      return nueva;
    },
  };
}

module.exports = { crearUsuariosDb };
