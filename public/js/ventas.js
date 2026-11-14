(function () {
  const el = (id) => document.getElementById(id);
  let inventarioCache = []; // items del inventario de vehículos + de Inventario Bodega, cada uno con "origen"
  let carrito = []; // { inventario_id, inventario_bodega_id, origen, nombre_repuesto, categoria, cantidad, precio_unitario, stockDisponible, bodega_numero }
  let usuarioActual = null;
  let negocioActual = null;

  function totalCarrito() {
    return carrito.reduce((acc, it) => acc + it.cantidad * it.precio_unitario, 0);
  }

  function renderCarrito() {
    el('carrito-vacio').style.display = carrito.length ? 'none' : 'block';
    el('carrito').innerHTML = carrito
      .map(
        (it, idx) => `
      <div class="item-venta" data-idx="${idx}">
        <div><strong>${it.nombre_repuesto}</strong> ${it.origen === 'bodega' ? `<span class="badge bodega">Bodega N°${it.bodega_numero ?? '—'}</span>` : ''}<br><small style="color:var(--gris-600)">${it.categoria || ''}</small></div>
        <input type="number" min="1" ${it.stockDisponible !== null ? `max="${it.stockDisponible}"` : ''} class="cant" value="${it.cantidad}">
        <input type="number" min="0" class="precio" value="${it.precio_unitario}">
        <div style="align-self:center; font-weight:700">${fmtCLP.format(it.cantidad * it.precio_unitario)}</div>
        <button type="button" class="btn secundario pequeno" data-quitar="${idx}">✕</button>
      </div>`
      )
      .join('');

    el('carrito').querySelectorAll('.cant').forEach((inp, i) => {
      inp.addEventListener('change', () => {
        const idx = Number(inp.closest('[data-idx]').dataset.idx);
        let val = Number(inp.value) || 1;
        if (carrito[idx].stockDisponible !== null && val > carrito[idx].stockDisponible) {
          val = carrito[idx].stockDisponible;
          alert(`Solo quedan ${val} en stock.`);
        }
        carrito[idx].cantidad = val;
        renderCarrito();
      });
    });
    el('carrito').querySelectorAll('.precio').forEach((inp) => {
      inp.addEventListener('change', () => {
        const idx = Number(inp.closest('[data-idx]').dataset.idx);
        carrito[idx].precio_unitario = Number(inp.value) || 0;
        renderCarrito();
      });
    });
    el('carrito').querySelectorAll('[data-quitar]').forEach((btn) => {
      btn.addEventListener('click', () => {
        carrito.splice(Number(btn.dataset.quitar), 1);
        renderCarrito();
      });
    });

    el('total-venta').textContent = fmtCLP.format(totalCarrito());
  }

  function agregarAlCarrito(item) {
    const existente = carrito.find((it) => it.inventario_id === (item.origen === 'bodega' ? null : item.id) && it.inventario_bodega_id === (item.origen === 'bodega' ? item.id : null));
    if (existente) {
      existente.cantidad += 1;
    } else {
      carrito.push({
        inventario_id: item.origen === 'bodega' ? null : item.id,
        inventario_bodega_id: item.origen === 'bodega' ? item.id : null,
        origen: item.origen,
        bodega_numero: item.compra_numero || null,
        nombre_repuesto: item.nombre,
        categoria: item.categoria,
        cantidad: 1,
        precio_unitario: item.precio_venta,
        stockDisponible: item.cantidad_disponible,
      });
    }
    renderCarrito();
    el('buscar-repuesto').value = '';
    el('resultados-busqueda').style.display = 'none';
  }

  // La clave de un ítem en el cache combinado es "origen:id" — los ids de
  // /api/inventario y /api/bodega/inventario son autoincrementales
  // independientes, así que pueden repetirse entre las dos tablas.
  function claveItem(it) {
    return `${it.origen}:${it.id}`;
  }

  // Además de buscar por nombre o código, se puede buscar por el N° del
  // vehículo o de la compra bodega de origen escribiendo "I-<n°>" (Inventario,
  // vehículo N°n°) o "IB-<n°>" (Inventario Bodega, compra N°n°) — ej: "I-3"
  // muestra los repuestos del Vehículo 3, "IB-1" los de la compra bodega 1.
  // Se busca por coincidencia de prefijo del número para poder ir escribiendo.
  el('buscar-repuesto').addEventListener('input', () => {
    const texto = el('buscar-repuesto').value.trim().toLowerCase();
    if (!texto) {
      el('resultados-busqueda').style.display = 'none';
      return;
    }
    const matchCodigo = texto.match(/^i(b)?-?(\d+)$/);
    let resultados;
    if (matchCodigo) {
      const esBodega = !!matchCodigo[1];
      const prefijo = matchCodigo[2];
      resultados = inventarioCache
        .filter((it) => {
          if (!it.activo || it.cantidad_disponible <= 0) return false;
          if (it.origen !== (esBodega ? 'bodega' : 'vehiculo')) return false;
          const numero = esBodega ? it.compra_numero : it.vehiculo_numero;
          return numero != null && String(numero).startsWith(prefijo);
        })
        .slice(0, 15);
    } else {
      resultados = inventarioCache
        .filter((it) => it.activo && it.cantidad_disponible > 0 && (it.nombre.toLowerCase().includes(texto) || (it.codigo || '').toLowerCase().includes(texto)))
        .slice(0, 15);
    }
    if (resultados.length === 0) {
      el('resultados-busqueda').innerHTML = `<div class="op">Sin resultados en tu inventario. <a href="/marketplace.html">Buscar en otras desarmadurías →</a></div>`;
      el('resultados-busqueda').style.display = 'block';
      return;
    }
    el('resultados-busqueda').innerHTML = resultados
      .map((it) => {
        const etiquetaBodega =
          it.origen === 'bodega'
            ? `<span class="badge bodega">IB-${it.compra_numero ?? '—'}</span> `
            : it.vehiculo_id
            ? `<span class="badge otro">I-${it.vehiculo_numero ?? '—'}</span> `
            : '';
        return `<div class="op" data-clave="${claveItem(it)}"><span style="display:flex;align-items:center;gap:8px">${etiquetaBodega}${it.nombre}</span><span class="stock">${fmtCLP.format(it.precio_venta)} · stock ${it.cantidad_disponible}</span></div>`;
      })
      .join('');
    el('resultados-busqueda').style.display = 'block';
    el('resultados-busqueda').querySelectorAll('[data-clave]').forEach((op) => {
      op.addEventListener('click', () => {
        const item = inventarioCache.find((i) => claveItem(i) === op.dataset.clave);
        if (item) agregarAlCarrito(item);
      });
    });
  });

  function ticketHTML(venta) {
    const fecha = new Date(venta.fecha).toLocaleString('es-CL');
    return `
      <h3>${negocioActual.nombre}</h3>
      <div style="text-align:center; font-size:0.8rem; color:var(--gris-600)">${negocioActual.direccion || ''}</div>
      <hr>
      <div class="linea"><span>Venta #${venta.id}</span><span>${fecha}</span></div>
      <div class="linea"><span>Vendedor</span><span>${usuarioActual.nombre}</span></div>
      ${venta.cliente_nombre ? `<div class="linea"><span>Cliente</span><span>${venta.cliente_nombre}</span></div>` : ''}
      <hr>
      ${venta.items
        .map(
          (it) =>
            `<div class="linea"><span>${it.cantidad} × ${it.nombre_repuesto}${it.origen === 'bodega' ? ' (Inventario Bodega)' : ''}</span><span>${fmtCLP.format(it.cantidad * it.precio_unitario)}</span></div>`
        )
        .join('')}
      <hr>
      <div class="linea total"><span>TOTAL</span><span>${fmtCLP.format(venta.total)}</span></div>
      <div class="linea"><span>Pago</span><span>${venta.tipo_pago.replace('_', ' ')}</span></div>
    `;
  }

  el('btn-cobrar').addEventListener('click', async () => {
    if (carrito.length === 0) {
      el('mensaje-venta').innerHTML = '<div class="mensaje error">Agrega al menos un repuesto a la venta.</div>';
      return;
    }
    el('btn-cobrar').disabled = true;
    try {
      const venta = await fetchJSON('/api/ventas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: carrito.map((it) => ({
            inventario_id: it.inventario_id,
            inventario_bodega_id: it.inventario_bodega_id,
            origen: it.origen,
            cantidad: it.cantidad,
            precio_unitario: it.precio_unitario,
          })),
          tipo_pago: el('tipo-pago').value,
          cliente_nombre: el('cliente-nombre').value.trim(),
          cliente_telefono: el('cliente-telefono').value.trim(),
        }),
      });
      el('ticket-contenido').innerHTML = ticketHTML(venta);
      el('card-pos').style.display = 'none';
      el('card-ticket').style.display = 'block';
      el('card-ticket').scrollIntoView({ behavior: 'smooth' });
      carrito = [];
      el('cliente-nombre').value = '';
      el('cliente-telefono').value = '';
      await cargarInventario();
      await cargarVentas();
    } catch (e) {
      el('mensaje-venta').innerHTML = `<div class="mensaje error">${e.message}</div>`;
    } finally {
      el('btn-cobrar').disabled = false;
    }
  });

  el('btn-imprimir').addEventListener('click', () => window.print());
  el('btn-nueva-venta').addEventListener('click', () => {
    el('card-ticket').style.display = 'none';
    el('card-pos').style.display = 'block';
    renderCarrito();
  });

  async function cargarInventario() {
    // Se busca en los dos inventarios a la vez: el que sale de desarmar
    // vehículos y el de Inventario Bodega (compra directa) — cada ítem queda
    // marcado con su "origen" para poder mostrarlo en los resultados, el
    // carrito y el ticket (ver claveItem() más arriba para el porqué del id
    // combinado con el origen).
    const [deVehiculos, deBodega] = await Promise.all([
      fetchJSON('/api/inventario'),
      fetchJSON('/api/bodega/inventario').catch(() => []),
    ]);
    inventarioCache = [
      ...deVehiculos.map((it) => ({ ...it, origen: 'vehiculo' })),
      ...deBodega.map((it) => ({ ...it, origen: 'bodega' })),
    ];
  }

  async function cargarVentas() {
    const ventas = await fetchJSON('/api/ventas');
    if (ventas.length === 0) {
      el('lista-ventas').innerHTML = '<p class="vacio">Todavía no hay ventas registradas.</p>';
      return;
    }
    const esAdmin = usuarioActual.rol === 'admin';
    el('lista-ventas').innerHTML = `
      <div class="tabla-scroll">
      <table>
        <thead><tr><th>#</th><th>Fecha</th><th>Vendedor</th><th>Repuestos</th><th>Total</th><th>Pago</th><th>Estado</th>${esAdmin ? '<th></th>' : ''}</tr></thead>
        <tbody>
          ${ventas
            .slice(0, 30)
            .map(
              (v) => `
            <tr>
              <td>${v.id}</td>
              <td>${new Date(v.fecha).toLocaleString('es-CL')}</td>
              <td>${v.vendedor_nombre}</td>
              <td>${v.items.map((it) => `${it.cantidad}× ${it.nombre_repuesto}${it.origen === 'bodega' ? ' <span class="badge bodega">Bodega</span>' : ''}`).join(', ')}</td>
              <td>${fmtCLP.format(v.total)}</td>
              <td><span class="badge ${v.tipo_pago}">${v.tipo_pago.replace('_', ' ')}</span></td>
              <td><span class="badge ${v.estado}">${v.estado}</span></td>
              ${esAdmin ? `<td>${v.estado === 'completada' ? `<button class="btn peligro pequeno" data-anular="${v.id}">Anular</button>` : ''}</td>` : ''}
            </tr>`
            )
            .join('')}
        </tbody>
      </table>
      </div>`;

    if (esAdmin) {
      el('lista-ventas').querySelectorAll('[data-anular]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (!confirm('¿Anular esta venta? El stock de los repuestos se repone.')) return;
          await fetchJSON(`/api/ventas/${btn.dataset.anular}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ estado: 'anulada' }),
          });
          await cargarInventario();
          await cargarVentas();
        });
      });
    }
  }

  window.__sesion.then(async (usuario) => {
    if (!usuario) return;
    usuarioActual = usuario;
    negocioActual = usuario.negocio;
    await cargarInventario();
    await cargarVentas();
    renderCarrito();
  });
})();
