(function () {
  const el = (id) => document.getElementById(id);

  let ordenActual = null; // orden completa que está abierta en el detalle
  let listaEnTaller = [];
  let listaEntregados = [];

  function fmtFecha(f) {
    return f ? new Date(f).toLocaleString('es-CL') : '—';
  }

  // ---------- Detalle de una orden (crear o abrir una existente) ----------
  function poblarCamposDetalle(o) {
    el('d-dueno-nombre').value = o.dueno_nombre || '';
    el('d-dueno-telefono').value = o.dueno_telefono || '';
    el('d-dueno-rut').value = o.dueno_rut || '';
    el('d-patente').value = o.vehiculo_patente || '';
    el('d-marca').value = o.vehiculo_marca || '';
    el('d-modelo').value = o.vehiculo_modelo || '';
    el('d-anio').value = o.vehiculo_anio || '';
    el('d-color').value = o.vehiculo_color || '';
    el('d-comentario').value = o.comentario_ingreso || '';
    el('d-presupuesto-monto').value = o.presupuesto_monto || 0;
    el('d-presupuesto-notas').value = o.presupuesto_notas || '';
    el('d-trabajos').value = o.trabajos_realizados || '';
    el('d-cobro-final').value = o.cobro_final != null ? o.cobro_final : o.presupuesto_monto || 0;

    el('detalle-titulo').textContent = `Orden N°${o.numero} — ${o.vehiculo_patente || ''} (${o.dueno_nombre})`;
    if (o.estado === 'en_taller') {
      el('detalle-badge-estado').className = 'badge en_desarme';
      el('detalle-badge-estado').textContent = 'En el taller';
      el('zona-entrega').style.display = 'block';
      el('zona-entregado').style.display = 'none';
    } else {
      el('detalle-badge-estado').className = 'badge desarmado';
      el('detalle-badge-estado').textContent = 'Entregado';
      el('zona-entrega').style.display = 'none';
      el('zona-entregado').style.display = 'block';
      el('e-fecha-entrega').textContent = fmtFecha(o.fecha_entrega);
      el('e-trabajos').textContent = o.trabajos_realizados || '(sin detalle registrado)';
      el('e-cobro-final').textContent = fmtCLP.format(o.cobro_final || 0);
      el('btn-descargar-pdf').href = `/api/taller/ordenes/${o.id}/pdf`;
    }
    el('mensaje-detalle').innerHTML = '';
  }

  async function abrirDetalle(id) {
    ordenActual = await fetchJSON(`/api/taller/ordenes/${id}`);
    poblarCamposDetalle(ordenActual);
    el('card-detalle').style.display = 'block';
    el('card-detalle').scrollIntoView({ behavior: 'smooth' });
  }

  el('btn-cerrar-detalle').addEventListener('click', () => {
    el('card-detalle').style.display = 'none';
    ordenActual = null;
  });

  // Guardado automático (debounce), igual que en Inventario/Vehículos.
  let temporizadorDetalle = null;
  document.querySelectorAll('#card-detalle [data-campo]').forEach((input) => {
    input.addEventListener('change', () => {
      if (!ordenActual) return;
      const campo = input.dataset.campo;
      const valor = input.type === 'number' ? Number(input.value) || 0 : input.value.trim();
      clearTimeout(temporizadorDetalle);
      temporizadorDetalle = setTimeout(async () => {
        try {
          await fetchJSON(`/api/taller/ordenes/${ordenActual.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ [campo]: valor }),
          });
          ErpAuth.toast('Guardado.', 'info');
          await cargarListas();
        } catch (err) {
          el('mensaje-detalle').innerHTML = `<div class="mensaje error">${err.message}</div>`;
        }
      }, 500);
    });
  });

  el('btn-entregar').addEventListener('click', async () => {
    if (!ordenActual) return;
    if (!confirm('¿Confirmas la entrega de este vehículo? Después de esto no se puede volver a editar la etapa de ingreso/entrega.')) return;
    el('btn-entregar').disabled = true;
    try {
      const trabajos = el('d-trabajos').value.trim();
      const cobro = Number(el('d-cobro-final').value) || 0;
      ordenActual = await fetchJSON(`/api/taller/ordenes/${ordenActual.id}/entregar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trabajos_realizados: trabajos, cobro_final: cobro }),
      });
      ordenActual = await fetchJSON(`/api/taller/ordenes/${ordenActual.id}`);
      poblarCamposDetalle(ordenActual);
      ErpAuth.toast('Vehículo entregado. Ya puedes descargar el PDF.', 'exito');
      await cargarListas();
    } catch (err) {
      ErpAuth.toast(err.message || 'No se pudo entregar el vehículo', 'error');
    } finally {
      el('btn-entregar').disabled = false;
    }
  });

  // ---------- Crear orden (ingreso) ----------
  el('btn-crear-orden').addEventListener('click', async () => {
    const nombre = el('t-dueno-nombre').value.trim();
    const patente = el('t-patente').value.trim();
    if (!nombre) { el('mensaje-crear-orden').innerHTML = '<div class="mensaje error">Falta el nombre del dueño.</div>'; return; }
    if (!patente) { el('mensaje-crear-orden').innerHTML = '<div class="mensaje error">Falta la patente del vehículo.</div>'; return; }
    el('btn-crear-orden').disabled = true;
    try {
      const orden = await fetchJSON('/api/taller/ordenes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dueno_nombre: nombre,
          dueno_telefono: el('t-dueno-telefono').value.trim(),
          dueno_rut: el('t-dueno-rut').value.trim(),
          vehiculo_patente: patente,
          vehiculo_marca: el('t-marca').value.trim(),
          vehiculo_modelo: el('t-modelo').value.trim(),
          vehiculo_anio: el('t-anio').value ? Number(el('t-anio').value) : null,
          vehiculo_color: el('t-color').value.trim(),
          comentario_ingreso: el('t-comentario').value.trim(),
          presupuesto_monto: el('t-presupuesto-monto').value ? Number(el('t-presupuesto-monto').value) : 0,
          presupuesto_notas: el('t-presupuesto-notas').value.trim(),
        }),
      });
      ['t-dueno-nombre', 't-dueno-telefono', 't-dueno-rut', 't-patente', 't-marca', 't-modelo', 't-anio', 't-color', 't-comentario', 't-presupuesto-monto', 't-presupuesto-notas'].forEach((id) => (el(id).value = ''));
      el('mensaje-crear-orden').innerHTML = `<div class="mensaje exito">✅ Vehículo ingresado como Orden N°${orden.numero}.</div>`;
      await cargarListas();
      await abrirDetalle(orden.id);
    } catch (err) {
      el('mensaje-crear-orden').innerHTML = `<div class="mensaje error">${err.message}</div>`;
    } finally {
      el('btn-crear-orden').disabled = false;
    }
  });

  // ---------- Listas ----------
  function filaLista(o, esEntregado) {
    return `
      <tr>
        <td><span class="badge otro">N°${o.numero}</span></td>
        <td>${o.dueno_nombre}</td>
        <td><strong>${o.vehiculo_patente}</strong> ${[o.vehiculo_marca, o.vehiculo_modelo].filter(Boolean).join(' ')}</td>
        <td>${fmtCLP.format(esEntregado ? (o.cobro_final || 0) : (o.presupuesto_monto || 0))}</td>
        <td>${fmtFecha(esEntregado ? o.fecha_entrega : o.fecha_ingreso)}</td>
        <td><button class="btn secundario pequeno" data-abrir="${o.id}">${esEntregado ? 'Ver / PDF' : 'Ver / Gestionar'}</button></td>
      </tr>`;
  }

  function renderListas() {
    el('lista-en-taller').innerHTML = listaEnTaller.length === 0
      ? '<p class="vacio">No hay vehículos en el taller por ahora.</p>'
      : `<div class="tabla-scroll"><table>
          <thead><tr><th>N°</th><th>Dueño</th><th>Vehículo</th><th>Presupuesto</th><th>Ingreso</th><th></th></tr></thead>
          <tbody>${listaEnTaller.map((o) => filaLista(o, false)).join('')}</tbody>
        </table></div>`;

    el('lista-entregados').innerHTML = listaEntregados.length === 0
      ? '<p class="vacio">Todavía no se ha entregado ningún vehículo.</p>'
      : `<div class="tabla-scroll"><table>
          <thead><tr><th>N°</th><th>Dueño</th><th>Vehículo</th><th>Cobrado</th><th>Entrega</th><th></th></tr></thead>
          <tbody>${listaEntregados.map((o) => filaLista(o, true)).join('')}</tbody>
        </table></div>`;

    document.querySelectorAll('[data-abrir]').forEach((btn) => {
      btn.addEventListener('click', () => abrirDetalle(btn.dataset.abrir));
    });
  }

  async function cargarListas() {
    [listaEnTaller, listaEntregados] = await Promise.all([
      fetchJSON('/api/taller/ordenes?estado=en_taller'),
      fetchJSON('/api/taller/ordenes?estado=entregado'),
    ]);
    renderListas();
  }

  window.__sesion.then((usuario) => {
    if (!usuario) return;
    cargarListas();
  });
})();
