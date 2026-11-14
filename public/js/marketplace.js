(function () {
  const el = (id) => document.getElementById(id);
  const CATEGORIAS = ['Motor', 'Tren delantero', 'Tren trasero', 'Transmisión', 'Cardán delantero', 'Cardán trasero', 'Suspensión', 'Frenos', 'Eléctrico', 'Carrocería', 'Interior', 'Neumáticos', 'Otro'];
  let usuarioActual = null;
  let conversacionActivaId = null;
  let poleoConversaciones = null;
  let poleoMensajes = null;

  el('filtro-categoria-mkt').innerHTML += CATEGORIAS.map((c) => `<option value="${c}">${c}</option>`).join('');

  // ---------- Buscar repuestos en otros negocios ----------
  async function buscarMkt() {
    const params = new URLSearchParams();
    if (el('buscar-marketplace').value.trim()) params.set('q', el('buscar-marketplace').value.trim());
    if (el('filtro-categoria-mkt').value) params.set('categoria', el('filtro-categoria-mkt').value);
    const data = await fetchJSON(`/api/marketplace/buscar?${params.toString()}`);
    if (data.length === 0) {
      el('resultados-mkt').innerHTML = '<p class="vacio">Nadie más tiene ese repuesto registrado por ahora.</p>';
      return;
    }
    el('resultados-mkt').innerHTML = data
      .map(
        (r) => `
      <div class="negocio-resultado">
        <div class="info-repuesto">
          <div class="nombre-repuesto">${r.nombre} <span class="badge otro">${r.categoria || 'Otro'}</span></div>
          <div class="negocio-nombre">🏪 ${r.negocio_nombre} — stock: ${r.cantidad_disponible} — ${fmtCLP.format(r.precio_venta)}</div>
        </div>
        <button class="btn secundario pequeno" data-contactar="${r.negocio_id}" data-repuesto="${r.nombre}">💬 Contactar</button>
      </div>`
      )
      .join('');
    el('resultados-mkt').querySelectorAll('[data-contactar]').forEach((btn) => {
      btn.addEventListener('click', () => iniciarConversacion(btn.dataset.contactar, `Hola, ¿todavía tienen disponible "${btn.dataset.repuesto}"? Tengo un cliente interesado.`));
    });
  }
  el('btn-buscar-mkt').addEventListener('click', buscarMkt);
  el('buscar-marketplace').addEventListener('keydown', (e) => { if (e.key === 'Enter') buscarMkt(); });

  // ---------- Chat ----------
  async function iniciarConversacion(negocioId, mensajeInicial) {
    const conv = await fetchJSON('/api/chat/conversaciones', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ negocio_id: Number(negocioId) }),
    });
    await cargarConversaciones();
    abrirConversacion(conv.id, conv.otro_negocio_nombre);
    if (mensajeInicial) {
      el('chat-input').value = mensajeInicial;
    }
  }

  el('btn-nuevo-chat').addEventListener('click', async () => {
    const negocios = await fetchJSON('/api/marketplace/negocios');
    if (negocios.length === 0) {
      alert('Todavía no hay otros negocios registrados en la plataforma.');
      return;
    }
    const opciones = negocios.map((n, i) => `${i + 1}. ${n.nombre}`).join('\n');
    const eleccion = prompt(`¿Con qué negocio quieres iniciar una conversación?\n\n${opciones}\n\nEscribe el número:`);
    const idx = Number(eleccion) - 1;
    if (Number.isNaN(idx) || !negocios[idx]) return;
    iniciarConversacion(negocios[idx].id);
  });

  function renderListaConversaciones(conversaciones) {
    if (conversaciones.length === 0) {
      el('lista-conversaciones').innerHTML = '<p class="vacio">Todavía no tienes conversaciones.</p>';
      return;
    }
    el('lista-conversaciones').innerHTML = conversaciones
      .map(
        (c) => `
      <div class="conversacion-item ${c.id === conversacionActivaId ? 'activa' : ''}" data-id="${c.id}" data-nombre="${c.otro_negocio_nombre}">
        <div class="nombre">${c.otro_negocio_nombre} ${c.no_leidos > 0 ? `<span class="no-leidos">${c.no_leidos}</span>` : ''}</div>
        <div class="preview">${c.ultimo_mensaje ? c.ultimo_mensaje.mensaje : 'Sin mensajes'}</div>
      </div>`
      )
      .join('');
    el('lista-conversaciones').querySelectorAll('.conversacion-item').forEach((item) => {
      item.addEventListener('click', () => abrirConversacion(Number(item.dataset.id), item.dataset.nombre));
    });
  }

  async function cargarConversaciones() {
    const data = await fetchJSON('/api/chat/conversaciones');
    renderListaConversaciones(data);
  }

  function renderMensajes(mensajes) {
    el('chat-mensajes').innerHTML = mensajes
      .map((m) => {
        const propio = m.negocio_emisor_id === usuarioActual.negocio.id;
        const hora = new Date(m.enviado_en).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
        return `<div class="chat-burbuja ${propio ? 'propio' : 'otro'}">${escaparHtml(m.mensaje)}<span class="hora">${hora}</span></div>`;
      })
      .join('');
    el('chat-mensajes').scrollTop = el('chat-mensajes').scrollHeight;
  }

  function escaparHtml(texto) {
    const div = document.createElement('div');
    div.textContent = texto;
    return div.innerHTML;
  }

  async function abrirConversacion(id, nombre) {
    conversacionActivaId = id;
    el('chat-sin-seleccion').style.display = 'none';
    el('chat-activo').style.display = 'block';
    el('chat-titulo').textContent = `🏪 ${nombre}`;
    await cargarMensajes();
    await cargarConversaciones();
    if (poleoMensajes) clearInterval(poleoMensajes);
    poleoMensajes = setInterval(cargarMensajes, 4000);
  }

  async function cargarMensajes() {
    if (!conversacionActivaId) return;
    const mensajes = await fetchJSON(`/api/chat/conversaciones/${conversacionActivaId}/mensajes`);
    renderMensajes(mensajes);
  }

  el('btn-enviar-mensaje').addEventListener('click', enviarMensaje);
  el('chat-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      enviarMensaje();
    }
  });

  async function enviarMensaje() {
    const texto = el('chat-input').value.trim();
    if (!texto || !conversacionActivaId) return;
    el('chat-input').value = '';
    await fetchJSON(`/api/chat/conversaciones/${conversacionActivaId}/mensajes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mensaje: texto }),
    });
    await cargarMensajes();
    await cargarConversaciones();
  }

  window.__sesion.then((usuario) => {
    if (!usuario) return;
    usuarioActual = usuario;
    cargarConversaciones();
    poleoConversaciones = setInterval(cargarConversaciones, 6000);
  });
})();
