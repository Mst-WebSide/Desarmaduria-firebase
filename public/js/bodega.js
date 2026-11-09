(function () {
  const el = (id) => document.getElementById(id);
  const CATEGORIAS = ['Motor', 'Tren delantero', 'Tren trasero', 'Transmisión', 'Cardán delantero', 'Cardán trasero', 'Suspensión', 'Frenos', 'Eléctrico', 'Carrocería', 'Interior', 'Neumáticos', 'Otro'];
  let usuarioActual = null;
  let puedeEditar = false;
  let repisasCache = [];
  let comprasCache = [];

  el('filtro-categoria-bodega').innerHTML += CATEGORIAS.map((c) => `<option value="${c}">${c}</option>`).join('');

  // ---------- Repisas ----------
  function opcionesRepisas(seleccionadaId) {
    return (
      '<option value="">— Sin repisa asignada —</option>' +
      repisasCache
        .map((r) => `<option value="${r.id}" ${String(r.id) === String(seleccionadaId) ? 'selected' : ''}>${r.nombre} (${r.cantidad_filas} filas)</option>`)
        .join('')
    );
  }

  function renderRepisas() {
    if (repisasCache.length === 0) {
      el('lista-repisas').innerHTML = '<p class="vacio">Todavía no hay repisas creadas.</p>';
      return;
    }
    el('lista-repisas').innerHTML = `
      <div class="tabla-scroll">
      <table>
        <thead><tr><th>Nombre</th><th>Cantidad de filas</th><th></th></tr></thead>
        <tbody>
          ${repisasCache
            .map(
              (r) => `
            <tr data-repisa="${r.id}">
              <td>${puedeEditar ? `<input type="text" class="edit-repisa-nombre" data-id="${r.id}" value="${r.nombre}" style="width:160px">` : r.nombre}</td>
              <td>${puedeEditar ? `<input type="number" min="1" class="edit-repisa-filas" data-id="${r.id}" value="${r.cantidad_filas}" style="width:80px">` : r.cantidad_filas}</td>
              <td>${puedeEditar ? `<button class="btn peligro pequeno" data-borrar-repisa="${r.id}">Eliminar</button>` : ''}</td>
            </tr>`
            )
            .join('')}
        </tbody>
      </table>
      </div>`;

    if (!puedeEditar) return;

    let temporizador = null;
    const guardar = (id, campo, valor) => {
      clearTimeout(temporizador);
      temporizador = setTimeout(async () => {
        try {
          await fetchJSON(`/api/repisas/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ [campo]: valor }),
          });
          ErpAuth.toast('Repisa actualizada.', 'exito');
          await cargarRepisas();
        } catch (e) {
          ErpAuth.toast(e.message || 'No se pudo guardar.', 'error');
          await cargarRepisas();
        }
      }, 500);
    };
    el('lista-repisas').querySelectorAll('.edit-repisa-nombre').forEach((inp) => {
      inp.addEventListener('change', () => guardar(inp.dataset.id, 'nombre', inp.value.trim()));
    });
    el('lista-repisas').querySelectorAll('.edit-repisa-filas').forEach((inp) => {
      inp.addEventListener('change', () => guardar(inp.dataset.id, 'cantidad_filas', Number(inp.value)));
    });
    el('lista-repisas').querySelectorAll('[data-borrar-repisa]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('¿Eliminar esta repisa? Solo se puede si no tiene repuestos guardados en ella.')) return;
        try {
          await fetchJSON(`/api/repisas/${btn.dataset.borrarRepisa}`, { method: 'DELETE' });
          await cargarRepisas();
        } catch (e) {
          ErpAuth.toast(e.message || 'No se pudo eliminar.', 'error');
        }
      });
    });
  }

  async function cargarRepisas() {
    repisasCache = await fetchJSON('/api/repisas');
    renderRepisas();
    // Refresca los <select> de repisa en las filas de piezas que ya estén abiertas.
    document.querySelectorAll('.pieza-repisa').forEach((sel) => {
      const actual = sel.value;
      sel.innerHTML = opcionesRepisas(actual);
    });
  }

  el('btn-crear-repisa').addEventListener('click', async () => {
    const nombre = el('rep-nombre').value.trim();
    if (!nombre) {
      el('mensaje-repisa').innerHTML = '<div class="mensaje error">Ingresa el nombre de la repisa.</div>';
      return;
    }
    try {
      await fetchJSON('/api/repisas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre, cantidad_filas: Number(el('rep-filas').value) || 1 }),
      });
      el('rep-nombre').value = '';
      el('rep-filas').value = 5;
      el('mensaje-repisa').innerHTML = '<div class="mensaje exito">✅ Repisa creada.</div>';
      await cargarRepisas();
    } catch (e) {
      el('mensaje-repisa').innerHTML = `<div class="mensaje error">${e.message}</div>`;
    }
  });

  // ---------- Piezas de la compra que se está registrando ----------
  function filaPiezaHTML() {
    return `
      <div class="pieza-fila">
        <div><label>Nombre</label><input type="text" class="pieza-nombre" placeholder="Ej: Block de motor"></div>
        <div><label>Categoría</label><select class="pieza-categoria">${CATEGORIAS.map((c) => `<option value="${c}">${c}</option>`).join('')}</select></div>
        <div><label>Cant.</label><input type="number" min="1" value="1" class="pieza-cantidad"></div>
        <div><label>Precio venta</label><input type="number" min="0" class="pieza-precio" placeholder="$"></div>
        <div><label>Repisa</label><select class="pieza-repisa">${opcionesRepisas()}</select></div>
        <div><label>Fila</label><input type="number" min="1" value="1" class="pieza-fila-num"></div>
        <button type="button" class="btn secundario pequeno btn-quitar-pieza">✕</button>
      </div>`;
  }

  function agregarFilaPieza() {
    const div = document.createElement('div');
    div.innerHTML = filaPiezaHTML();
    const fila = div.firstElementChild;
    fila.querySelector('.btn-quitar-pieza').addEventListener('click', () => fila.remove());
    el('piezas-compra').appendChild(fila);
  }

  el('btn-agregar-pieza').addEventListener('click', agregarFilaPieza);

  function recolectarPiezas() {
    return Array.from(el('piezas-compra').querySelectorAll('.pieza-fila'))
      .map((fila) => ({
        nombre: fila.querySelector('.pieza-nombre').value.trim(),
        categoria: fila.querySelector('.pieza-categoria').value,
        cantidad: Number(fila.querySelector('.pieza-cantidad').value) || 1,
        precio_venta: Number(fila.querySelector('.pieza-precio').value) || 0,
        repisa_id: fila.querySelector('.pieza-repisa').value || null,
        fila: Number(fila.querySelector('.pieza-fila-num').value) || 1,
      }))
      .filter((p) => p.nombre);
  }

  function limpiarPiezas() {
    el('piezas-compra').innerHTML = '';
    agregarFilaPieza();
  }

  el('btn-crear-compra').addEventListener('click', async () => {
    const nombre = el('c-nombre').value.trim();
    if (!nombre) {
      el('mensaje-compra').innerHTML = '<div class="mensaje error">Ingresa el nombre de la compra (ej: "Motor").</div>';
      return;
    }
    const piezas = recolectarPiezas();
    el('btn-crear-compra').disabled = true;
    try {
      const compra = await fetchJSON('/api/bodega/compras', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nombre,
          proveedor: el('c-proveedor').value.trim(),
          costo_total: Number(el('c-costo').value) || 0,
          observaciones: el('c-obs').value.trim(),
        }),
      });

      let agregadas = 0;
      let fallidas = 0;
      for (const p of piezas) {
        try {
          await fetchJSON('/api/bodega/inventario', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              compra_id: compra.id,
              nombre: p.nombre,
              categoria: p.categoria,
              cantidad_disponible: p.cantidad,
              cantidad_minima: 1,
              precio_venta: p.precio_venta,
              repisa_id: p.repisa_id,
              fila: p.fila,
            }),
          });
          agregadas += 1;
        } catch (e) {
          fallidas += 1;
        }
      }

      ['c-nombre', 'c-proveedor', 'c-costo', 'c-obs'].forEach((id) => (el(id).value = ''));
      limpiarPiezas();
      const resumen = piezas.length === 0
        ? ' No agregaste piezas — puedes hacerlo después editando el inventario bodega.'
        : ` Se cargaron ${agregadas} pieza(s).${fallidas ? ` (${fallidas} no se pudieron guardar)` : ''}`;
      el('mensaje-compra').innerHTML = `<div class="mensaje exito">✅ Compra N°${compra.numero} — "${compra.nombre}" registrada.${resumen}</div>`;
      await Promise.all([cargarCompras(), cargarInventarioBodega()]);
    } catch (e) {
      el('mensaje-compra').innerHTML = `<div class="mensaje error">${e.message}</div>`;
    } finally {
      el('btn-crear-compra').disabled = false;
    }
  });

  // ---------- Listado de compras ----------
  function renderCompras() {
    if (comprasCache.length === 0) {
      el('lista-compras').innerHTML = '<p class="vacio">Todavía no hay compras registradas.</p>';
      return;
    }
    el('lista-compras').innerHTML = `
      <div class="tabla-scroll">
      <table>
        <thead><tr><th>N°</th><th>Nombre</th><th>Proveedor</th><th>Costo total</th><th>Ingreso</th><th></th></tr></thead>
        <tbody>
          ${comprasCache
            .map(
              (c) => `
            <tr>
              <td><span class="badge bodega">N°${c.numero}</span></td>
              <td><strong>${c.nombre}</strong></td>
              <td>${c.proveedor || '—'}</td>
              <td>${fmtCLP.format(c.costo_total || 0)}</td>
              <td>${new Date(c.fecha_ingreso).toLocaleDateString('es-CL')}</td>
              <td><button class="btn secundario pequeno" data-ver-compra="${c.id}">Ver piezas</button></td>
            </tr>`
            )
            .join('')}
        </tbody>
      </table>
      </div>`;

    el('lista-compras').querySelectorAll('[data-ver-compra]').forEach((btn) => {
      btn.addEventListener('click', () => verDetalleCompra(btn.dataset.verCompra));
    });
  }

  async function verDetalleCompra(id) {
    const compra = await fetchJSON(`/api/bodega/compras/${id}`);
    el('detalle-compra-nombre').textContent = `N°${compra.numero} — ${compra.nombre}`;
    if (compra.piezas.length === 0) {
      el('detalle-piezas').innerHTML = '<p class="vacio">Esta compra todavía no tiene piezas cargadas.</p>';
    } else {
      el('detalle-piezas').innerHTML = `
        <div class="tabla-scroll">
        <table>
          <thead><tr><th>Repuesto</th><th>Categoría</th><th>Stock</th><th>Precio venta</th><th>Ubicación</th></tr></thead>
          <tbody>
            ${compra.piezas
              .map(
                (p) => `<tr><td>${p.nombre}</td><td>${p.categoria || '—'}</td><td>${p.cantidad_disponible}</td><td>${fmtCLP.format(p.precio_venta)}</td><td>${p.repisa_nombre ? `${p.repisa_nombre}, fila ${p.fila}` : '—'}</td></tr>`
              )
              .join('')}
          </tbody>
        </table>
        </div>`;
    }
    el('card-detalle-compra').style.display = 'block';
    el('card-detalle-compra').scrollIntoView({ behavior: 'smooth' });
  }

  el('btn-cerrar-detalle-compra').addEventListener('click', () => { el('card-detalle-compra').style.display = 'none'; });

  async function cargarCompras() {
    comprasCache = await fetchJSON('/api/bodega/compras');
    renderCompras();
  }

  // ---------- Listado de inventario bodega ----------
  function ubicacionHTML(it) {
    return it.repisa_nombre ? `${it.repisa_nombre}, fila ${it.fila}` : '<span style="color:var(--gris-400)">Sin asignar</span>';
  }

  function filaInventarioHTML(it) {
    const bajo = it.cantidad_disponible <= it.cantidad_minima;
    const origenTexto = it.compra_numero ? `<span class="badge bodega">IB-${it.compra_numero}</span> ${it.compra_nombre || ''}` : '—';
    if (!puedeEditar) {
      return `
        <tr>
          <td>${it.nombre}${it.codigo ? `<br><small style="color:var(--gris-600)">${it.codigo}</small>` : ''}</td>
          <td>${it.categoria || '—'}</td>
          <td>${origenTexto}</td>
          <td>${ubicacionHTML(it)}</td>
          <td>${bajo ? `<span class="badge bajo-stock">${it.cantidad_disponible}</span>` : it.cantidad_disponible}</td>
          <td>${fmtCLP.format(it.precio_venta)}</td>
        </tr>`;
    }
    return `
      <tr data-fila="${it.id}">
        <td>${it.nombre}${it.codigo ? `<br><small style="color:var(--gris-600)">${it.codigo}</small>` : ''}</td>
        <td>
          <select class="edit-categoria" data-id="${it.id}" style="width:130px">
            ${CATEGORIAS.map((c) => `<option value="${c}" ${c === it.categoria ? 'selected' : ''}>${c}</option>`).join('')}
          </select>
        </td>
        <td>${origenTexto}</td>
        <td>${ubicacionHTML(it)}</td>
        <td><input type="number" min="0" class="edit-cantidad" data-id="${it.id}" value="${it.cantidad_disponible}" style="width:80px; ${bajo ? 'border-color:var(--rojo)' : ''}"></td>
        <td><input type="number" min="0" class="edit-precio" data-id="${it.id}" value="${it.precio_venta}" style="width:110px"></td>
        <td><button type="button" class="btn peligro pequeno btn-eliminar-repuesto-bodega" data-id="${it.id}" data-nombre="${it.nombre}">Eliminar</button></td>
      </tr>`;
  }

  function renderInventarioBodega(data) {
    if (data.length === 0) {
      el('lista-inventario-bodega').innerHTML = '<p class="vacio">No hay repuestos para este filtro.</p>';
      return;
    }
    el('lista-inventario-bodega').innerHTML = `
      <div class="tabla-scroll">
      <table>
        <thead><tr><th>Repuesto</th><th>Categoría</th><th>De qué compra</th><th>Ubicación</th><th>Stock</th><th>Precio venta</th>${puedeEditar ? '<th></th>' : ''}</tr></thead>
        <tbody>${data.map(filaInventarioHTML).join('')}</tbody>
      </table>
      </div>`;

    if (!puedeEditar) return;
    let temporizador = null;
    const guardar = (id, campo, valor) => {
      clearTimeout(temporizador);
      temporizador = setTimeout(async () => {
        try {
          await fetchJSON(`/api/bodega/inventario/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ [campo]: valor }),
          });
        } catch (e) {
          alert(`No se pudo guardar: ${e.message}`);
        }
      }, 500);
    };
    el('lista-inventario-bodega').querySelectorAll('.edit-categoria').forEach((sel) => {
      sel.addEventListener('change', () => guardar(sel.dataset.id, 'categoria', sel.value));
    });
    el('lista-inventario-bodega').querySelectorAll('.edit-cantidad').forEach((inp) => {
      inp.addEventListener('change', () => guardar(inp.dataset.id, 'cantidad_disponible', Number(inp.value)));
    });
    el('lista-inventario-bodega').querySelectorAll('.edit-precio').forEach((inp) => {
      inp.addEventListener('change', () => guardar(inp.dataset.id, 'precio_venta', Number(inp.value)));
    });
    el('lista-inventario-bodega').querySelectorAll('.btn-eliminar-repuesto-bodega').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm(`¿Eliminar el repuesto "${btn.dataset.nombre}"? Esta acción no se puede deshacer.`)) return;
        try {
          await fetchJSON(`/api/bodega/inventario/${btn.dataset.id}`, { method: 'DELETE' });
          ErpAuth.toast('Repuesto eliminado.', 'exito');
          await cargarInventarioBodega();
        } catch (e) {
          ErpAuth.toast(e.message || 'No se pudo eliminar.', 'error');
        }
      });
    });
  }

  async function cargarInventarioBodega() {
    const params = new URLSearchParams();
    if (el('buscar-bodega').value.trim()) params.set('q', el('buscar-bodega').value.trim());
    if (el('filtro-categoria-bodega').value) params.set('categoria', el('filtro-categoria-bodega').value);
    if (el('filtro-bajo-stock-bodega').checked) params.set('bajo_stock', '1');
    const data = await fetchJSON(`/api/bodega/inventario?${params.toString()}`);
    renderInventarioBodega(data);
  }

  let temporizadorBusqueda = null;
  el('buscar-bodega').addEventListener('input', () => {
    clearTimeout(temporizadorBusqueda);
    temporizadorBusqueda = setTimeout(cargarInventarioBodega, 300);
  });
  el('filtro-categoria-bodega').addEventListener('change', cargarInventarioBodega);
  el('filtro-bajo-stock-bodega').addEventListener('change', cargarInventarioBodega);
  el('btn-refrescar-bodega').addEventListener('click', cargarInventarioBodega);

  window.__sesion.then(async (usuario) => {
    if (!usuario) return;
    usuarioActual = usuario;
    puedeEditar = usuario.rol === 'admin' || usuario.rol === 'mecanico_lider';
    if (puedeEditar) {
      el('card-repisas').style.display = 'block';
      el('card-nueva-compra').style.display = 'block';
    }
    await cargarRepisas();
    limpiarPiezas();
    await Promise.all([cargarCompras(), cargarInventarioBodega()]);
  });
})();
