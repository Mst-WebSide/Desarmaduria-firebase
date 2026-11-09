// Acceso a /chats (entre negocios) en Firestore. El id del documento de una
// conversación es "{idMenor}_{idMayor}" (los dos negocios ordenados) — así
// se encuentra o crea sin necesitar una consulta "WHERE a = ? AND b = ?"
// como en la versión SQL: alcanza con construir el id y hacer un .get().
function crearChatDb(db) {
  const chatsCol = () => db.collection('chats');
  const mensajesCol = (chatId) => chatsCol().doc(chatId).collection('mensajes');

  function idDe(negocioA, negocioB) {
    const [a, b] = [String(negocioA), String(negocioB)].sort();
    return `${a}_${b}`;
  }

  return {
    idDe,

    async obtenerOCrear(negocioA, negocioB, ahora) {
      const id = idDe(negocioA, negocioB);
      const ref = chatsCol().doc(id);
      const snap = await ref.get();
      if (snap.exists) return { id, ...snap.data() };
      const [a, b] = [String(negocioA), String(negocioB)].sort();
      const datos = { negocio_a_id: a, negocio_b_id: b, creado_en: ahora(), ultimo_mensaje_en: ahora() };
      await ref.set(datos);
      return { id, ...datos };
    },

    async obtener(chatId) {
      const snap = await chatsCol().doc(chatId).get();
      return snap.exists ? { id: snap.id, ...snap.data() } : null;
    },

    // Reemplaza el "WHERE negocio_a_id = ? OR negocio_b_id = ?" de la
    // versión SQL con dos consultas (Firestore no tiene OR entre campos
    // distintos de forma simple) y se combinan los resultados.
    async listarPorNegocio(negocioId) {
      const id = String(negocioId);
      const [comoA, comoB] = await Promise.all([chatsCol().where('negocio_a_id', '==', id).get(), chatsCol().where('negocio_b_id', '==', id).get()]);
      const vistos = new Set();
      const resultado = [];
      for (const d of [...comoA.docs, ...comoB.docs]) {
        if (vistos.has(d.id)) continue;
        vistos.add(d.id);
        resultado.push({ id: d.id, ...d.data() });
      }
      resultado.sort((x, y) => (x.ultimo_mensaje_en < y.ultimo_mensaje_en ? 1 : -1));
      return resultado;
    },

    async actualizarUltimoMensaje(chatId, fecha) {
      await chatsCol().doc(chatId).update({ ultimo_mensaje_en: fecha });
    },

    async listarMensajes(chatId) {
      const snap = await mensajesCol(chatId).get();
      return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.enviado_en < b.enviado_en ? -1 : 1));
    },

    async crearMensaje(chatId, datos) {
      const ref = await mensajesCol(chatId).add(datos);
      return ref.id;
    },

    // Marca como leídos los mensajes que mandó EL OTRO negocio (no los
    // propios) — sin UPDATE masivo en Firestore, hay que traerlos y
    // actualizar uno por uno.
    async marcarLeidos(chatId, negocioId) {
      const mensajes = await this.listarMensajes(chatId);
      const pendientes = mensajes.filter((m) => !m.leido && String(m.negocio_emisor_id) !== String(negocioId));
      for (const m of pendientes) {
        await mensajesCol(chatId).doc(m.id).update({ leido: true });
      }
    },
  };
}

module.exports = { crearChatDb };
