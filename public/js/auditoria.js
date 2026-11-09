(function () {
  const el = (id) => document.getElementById(id);
  const CATEGORIAS = ['Motor', 'Tren delantero', 'Tren trasero', 'Transmisión', 'Cardán delantero', 'Cardán trasero', 'Suspensión', 'Frenos', 'Eléctrico', 'Carrocería', 'Interior', 'Neumáticos', 'Otro'];
  // Debe coincidir con las claves de ACCIONES en auditoria.js (backend).
  const ACCION_LABEL = {
    venta_creada: 'Venta registrada',
    venta_anulada: 'Venta anulada',
    vehiculo_creado: 'Vehículo ingresado',
    vehiculo_desarmado: 'Vehículo desarmado',
    vehiculo_editado: 'Vehículo editado',
    inventario_creado: 'Repuesto creado',
    inventario_editado: 'Repuesto editado',
    repisa_creada: 'Repisa creada/eliminada',
    repisa_editada: 'Repisa editada',
    bodega_compra_creada: 'Compra bodega registrada',
    bodega_compra_editada: 'Compra bodega editada',
    bodega_inventario_creado: 'Repuesto de bodega creado',
    bodega_inventario_editado: 'Repuesto de bodega editado',
    usuario_creado: 'Usuario creado',
    usuario_editado: 'Usuario editado',
    password_visto: 'Contraseña vista por un admin',
    password_desbloqueado: 'Ver contraseña desbloqueado con clave maestra',
    negocio_actualizado: 'Datos del negocio actualizados',
    taller_orden_creada: 'Vehículo ingresado al taller',
    taller_orden_editada: 'Orden de taller editada',
    taller_orden_entregada: 'Vehículo entregado desde el taller',
  };
  // Reutiliza las clases .badge ya definidas en style.css (no hay una clase
  // "exito" genérica, así que se pisan las existentes por su color).
  const ACCION_BADGE = {
    venta_creada: 'completada', venta_anulada: 'anulada',
    vehiculo_creado: 'completada', vehiculo_desarmado: 'desarmado', vehiculo_editado: 'en_desarme',
    inventario_creado: 'completada', inventario_editado: 'en_desarme',
    repisa_creada: 'completada', repisa_editada: 'en_desarme',
    bodega_compra_creada: 'completada', bodega_compra_editada: 'en_desarme',
    bodega_inventario_creado: 'completada', bodega_inventario_editado: 'en_desarme',
    usuario_creado: 'admin', usuario_editado: 'mecanico_lider',
    password_visto: 'vendedor', password_desbloqueado: 'anulada',
    negocio_actualizado: 'mecanico_lider',
    taller_orden_creada: 'completada', taller_orden_editada: 'en_desarme', taller_orden_entregada: 'desarmado',
  };

  // Muestra de dónde salió el repuesto vendido: de un vehículo, de
  // Inventario Bodega (con el número de esa compra), o "Genérico" si no
  // estaba ligado a nada — ver "origen" en venta_items (server.js).
  function origenHTML(f) {
    if (f.origen === 'bodega') {
      return `<span class="badge bodega">Bodega N°${f.bodega_numero ?? '—'}</span> <span style="color:var(--gris-600)">${f.bodega_compra_nombre || ''}</span>`;
    }
    // vehiculo_numero es el dato confiable de "vino de un vehículo" — la
    // patente es opcional, así que puede faltar aunque sí venga de uno.
    if (f.vehiculo_numero != null) {
      const etiqueta = f.vehiculo_patente || `Vehículo ${f.vehiculo_numero}`;
      return `${etiqueta} <span style="color:var(--gris-600)">(${[f.vehiculo_marca, f.vehiculo_modelo].filter(Boolean).join(' ')})</span>`;
    }
    return '<span class="vacio" style="padding:0">Genérico</span>';
  }

  function descargar(url) {
    const a = document.createElement('a');
    a.href = url;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function query(params) {
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) usp.set(k, v);
    const s = usp.toString();
    return s ? `?${s}` : '';
  }

  function filtrosVentas() {
    return {
      usuario_id: el('dv-usuario').value,
      categoria: el('dv-categoria').value,
      q: el('dv-buscar').value.trim(),
      desde: el('dv-desde').value,
      hasta: el('dv-hasta').value ? `${el('dv-hasta').value}T23:59:59.999Z` : '',
    };
  }

  function filtrosAuditoria() {
    return {
      usuario_id: el('da-usuario').value,
      accion: el('da-accion').value,
      desde: el('da-desde').value,
      hasta: el('da-hasta').value ? `${el('da-hasta').value}T23:59:59.999Z` : '',
    };
  }

  async function cargarDetalleVentas() {
    const data = await fetchJSON(`/api/reportes/ventas-detalle${query(filtrosVentas())}`);
    if (data.length === 0) {
      el('resumen-detalle-ventas').textContent = '';
      el('tabla-detalle-ventas').innerHTML = '<p class="vacio">No hay ventas que calcen con este filtro.</p>';
      return;
    }
    const totalUnidades = data.reduce((s, f) => s + f.cantidad, 0);
    const totalMonto = data.reduce((s, f) => s + f.subtotal, 0);
    el('resumen-detalle-ventas').textContent = `${fmtNum.format(data.length)} ítems — ${fmtNum.format(totalUnidades)} unidades — ${fmtCLP.format(totalMonto)} en total`;
    el('tabla-detalle-ventas').innerHTML = `
      <div class="tabla-scroll">
      <table>
        <thead><tr>
          <th>Fecha</th><th>Vendedor</th><th>Repuesto</th><th>Categoría</th><th>Cant.</th>
          <th>Precio unit.</th><th>Subtotal</th><th>Origen</th><th>Cliente</th><th>Pago</th><th>Estado</th>
        </tr></thead>
        <tbody>
          ${data
            .map(
              (f) => `
            <tr>
              <td>${new Date(f.fecha).toLocaleString('es-CL')}</td>
              <td>${f.vendedor_nombre}</td>
              <td>${f.nombre_repuesto}</td>
              <td>${f.categoria || '—'}</td>
              <td>${fmtNum.format(f.cantidad)}</td>
              <td>${fmtCLP.format(f.precio_unitario)}</td>
              <td>${fmtCLP.format(f.subtotal)}</td>
              <td>${origenHTML(f)}</td>
              <td>${f.cliente_nombre || '—'}</td>
              <td><span class="badge ${f.tipo_pago}">${f.tipo_pago}</span></td>
              <td><span class="badge ${f.estado}">${f.estado}</span></td>
            </tr>`
            )
            .join('')}
        </tbody>
      </table>
      </div>`;
  }

  async function cargarAuditoria() {
    const data = await fetchJSON(`/api/auditoria${query(filtrosAuditoria())}`);
    if (data.length === 0) {
      el('tabla-auditoria').innerHTML = '<p class="vacio">No hay actividad registrada con este filtro.</p>';
      return;
    }
    el('tabla-auditoria').innerHTML = `
      <div class="tabla-scroll">
      <table>
        <thead><tr><th>Fecha</th><th>Usuario</th><th>Rol</th><th>Acción</th><th>Detalle</th></tr></thead>
        <tbody>
          ${data
            .map(
              (a) => `
            <tr>
              <td>${new Date(a.fecha).toLocaleString('es-CL')}</td>
              <td>${a.usuario_nombre || '—'}</td>
              <td>${ErpAuth.ROL_LABEL[a.rol] || a.rol || '—'}</td>
              <td><span class="badge ${ACCION_BADGE[a.accion] || 'otro'}">${ACCION_LABEL[a.accion] || a.accion}</span></td>
              <td>${a.detalle || ''}</td>
            </tr>`
            )
            .join('')}
        </tbody>
      </table>
      </div>`;
  }

  window.__sesion.then(async (usuario) => {
    if (!usuario) return;
    el('dv-categoria').innerHTML += CATEGORIAS.map((c) => `<option value="${c}">${c}</option>`).join('');
    el('da-accion').innerHTML += Object.entries(ACCION_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');

    const usuarios = await fetchJSON('/api/usuarios');
    const opcionesUsuarios = usuarios.map((u) => `<option value="${u.id}">${u.nombre}</option>`).join('');
    el('dv-usuario').innerHTML += opcionesUsuarios;
    el('da-usuario').innerHTML += opcionesUsuarios;

    el('btn-filtrar-ventas').addEventListener('click', cargarDetalleVentas);
    el('btn-filtrar-auditoria').addEventListener('click', cargarAuditoria);
    el('btn-exportar-ventas').addEventListener('click', () => descargar(`/api/reportes/ventas-detalle${query({ ...filtrosVentas(), formato: 'csv' })}`));
    el('btn-exportar-auditoria').addEventListener('click', () => descargar(`/api/auditoria${query({ ...filtrosAuditoria(), formato: 'csv' })}`));

    await Promise.all([cargarDetalleVentas(), cargarAuditoria()]);
  });
})();
