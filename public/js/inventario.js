(function () {
  const el = (id) => document.getElementById(id);
  const CATEGORIAS = ['Motor', 'Tren delantero', 'Tren trasero', 'Transmisión', 'Cardán delantero', 'Cardán trasero', 'Suspensión', 'Frenos', 'Eléctrico', 'Carrocería', 'Interior', 'Neumáticos', 'Otro'];
  let usuarioActual = null;
  let puedeEditar = false;

  el('r-categoria').innerHTML = CATEGORIAS.map((c) => `<option value="${c}">${c}</option>`).join('');
  el('filtro-categoria').innerHTML += CATEGORIAS.map((c) => `<option value="${c}">${c}</option>`).join('');

  function filaHTML(it) {
    const bajo = it.cantidad_disponible <= it.cantidad_minima;
    // it.vehiculo_id (no la patente, que es opcional) es lo que dice si este
    // repuesto salió de un vehículo o es genérico.
    const vehiculoTexto = it.vehiculo_id
      ? `<span class="badge otro">I-${it.vehiculo_numero ?? '—'}</span>${it.vehiculo_patente ? ` ${it.vehiculo_patente}` : ''} (${it.vehiculo_marca || ''} ${it.vehiculo_modelo || ''})`
      : '<span style="color:var(--gris-400)">Genérico</span>';
    if (!puedeEditar) {
      return `
        <tr>
          <td>${it.nombre}${it.codigo ? `<br><small style="color:var(--gris-600)">${it.codigo}</small>` : ''}</td>
          <td>${it.categoria || '—'}</td>
          <td>${vehiculoTexto}</td>
          <td>${bajo ? `<span class="badge bajo-stock">${it.cantidad_disponible}</span>` : it.cantidad_disponible}</td>
          <td>${fmtCLP.format(it.precio_venta)}</td>
          <td>${it.ubicacion || '—'}</td>
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
        <td>${vehiculoTexto}</td>
        <td><input type="number" min="0" class="edit-cantidad" data-id="${it.id}" value="${it.cantidad_disponible}" style="width:80px; ${bajo ? 'border-color:var(--rojo)' : ''}"></td>
        <td><input type="number" min="0" class="edit-precio" data-id="${it.id}" value="${it.precio_venta}" style="width:110px"></td>
        <td>${it.ubicacion || '—'}</td>
        <td><button type="button" class="btn peligro pequeno btn-eliminar-repuesto" data-id="${it.id}" data-nombre="${it.nombre}">Eliminar</button></td>
      </tr>`;
  }

  function render(data) {
    if (data.length === 0) {
      el('lista-inventario').innerHTML = '<p class="vacio">No hay repuestos para este filtro.</p>';
      return;
    }
    el('lista-inventario').innerHTML = `
      <div class="tabla-scroll">
      <table>
        <thead><tr><th>Repuesto</th><th>Categoría</th><th>De qué vehículo</th><th>Stock</th><th>Precio venta</th><th>Ubicación</th>${puedeEditar ? '<th></th>' : ''}</tr></thead>
        <tbody>${data.map(filaHTML).join('')}</tbody>
      </table>
      </div>`;

    if (puedeEditar) {
      let temporizador = null;
      const guardar = (id, campo, valor) => {
        clearTimeout(temporizador);
        temporizador = setTimeout(async () => {
          try {
            await fetchJSON(`/api/inventario/${id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ [campo]: valor }),
            });
          } catch (e) {
            alert(`No se pudo guardar: ${e.message}`);
          }
        }, 500);
      };
      el('lista-inventario').querySelectorAll('.edit-categoria').forEach((sel) => {
        sel.addEventListener('change', () => guardar(sel.dataset.id, 'categoria', sel.value));
      });
      el('lista-inventario').querySelectorAll('.edit-cantidad').forEach((inp) => {
        inp.addEventListener('change', () => guardar(inp.dataset.id, 'cantidad_disponible', Number(inp.value)));
      });
      el('lista-inventario').querySelectorAll('.edit-precio').forEach((inp) => {
        inp.addEventListener('change', () => guardar(inp.dataset.id, 'precio_venta', Number(inp.value)));
      });
      el('lista-inventario').querySelectorAll('.btn-eliminar-repuesto').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (!confirm(`¿Eliminar el repuesto "${btn.dataset.nombre}"? Esta acción no se puede deshacer.`)) return;
          try {
            await fetchJSON(`/api/inventario/${btn.dataset.id}`, { method: 'DELETE' });
            ErpAuth.toast('Repuesto eliminado.', 'exito');
            await cargar();
          } catch (e) {
            ErpAuth.toast(e.message || 'No se pudo eliminar.', 'error');
          }
        });
      });
    }
  }

  async function cargar() {
    const params = new URLSearchParams();
    if (el('buscar').value.trim()) params.set('q', el('buscar').value.trim());
    if (el('filtro-categoria').value) params.set('categoria', el('filtro-categoria').value);
    if (el('filtro-bajo-stock').checked) params.set('bajo_stock', '1');
    const data = await fetchJSON(`/api/inventario?${params.toString()}`);
    render(data);
  }

  let temporizadorBusqueda = null;
  el('buscar').addEventListener('input', () => {
    clearTimeout(temporizadorBusqueda);
    temporizadorBusqueda = setTimeout(cargar, 300);
  });
  el('filtro-categoria').addEventListener('change', cargar);
  el('filtro-bajo-stock').addEventListener('change', cargar);
  el('btn-refrescar').addEventListener('click', cargar);

  el('btn-crear-repuesto').addEventListener('click', async () => {
    const nombre = el('r-nombre').value.trim();
    if (!nombre) {
      el('mensaje-repuesto').innerHTML = '<div class="mensaje error">Ingresa el nombre del repuesto.</div>';
      return;
    }
    el('btn-crear-repuesto').disabled = true;
    try {
      await fetchJSON('/api/inventario', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nombre,
          codigo: el('r-codigo').value.trim(),
          categoria: el('r-categoria').value,
          cantidad_disponible: Number(el('r-cantidad').value) || 0,
          cantidad_minima: Number(el('r-minima').value) || 1,
          precio_venta: Number(el('r-precio').value) || 0,
          costo_unitario: Number(el('r-costo').value) || 0,
          ubicacion: el('r-ubicacion').value.trim(),
          vehiculo_id: el('r-vehiculo').value || null,
        }),
      });
      ['r-nombre', 'r-codigo', 'r-precio', 'r-costo', 'r-ubicacion'].forEach((id) => (el(id).value = ''));
      el('r-cantidad').value = 1;
      el('r-minima').value = 1;
      el('r-vehiculo').value = '';
      el('mensaje-repuesto').innerHTML = '<div class="mensaje exito">✅ Repuesto agregado al inventario.</div>';
      await cargar();
    } catch (e) {
      el('mensaje-repuesto').innerHTML = `<div class="mensaje error">${e.message}</div>`;
    } finally {
      el('btn-crear-repuesto').disabled = false;
    }
  });

  // ---------- Carga masiva por Excel (Inventario + Inventario Bodega) ----------
  function archivoABase64(archivo) {
    return new Promise((resolve, reject) => {
      const lector = new FileReader();
      lector.onerror = () => reject(new Error('No se pudo leer el archivo'));
      lector.onload = () => resolve(lector.result); // data:...;base64,XXXX
      lector.readAsDataURL(archivo);
    });
  }

  function renderResultadoCargaMasiva(data, esError) {
    if (esError) {
      const listaErrores = (data.errores || []).map((e) => `<li>${e.mensaje}</li>`).join('');
      el('mensaje-carga-masiva').innerHTML = `
        <div class="mensaje error">
          ${data.error || 'No se pudo procesar el archivo.'}
          ${listaErrores ? `<ul style="margin:8px 0 0; padding-left:20px">${listaErrores}</ul>` : ''}
        </div>`;
      return;
    }
    el('mensaje-carga-masiva').innerHTML = `
      <div class="mensaje exito">
        ✅ Carga masiva completada: ${data.creados_vehiculos || 0} vehículo(s) nuevo(s), ${data.creados_inventario} repuesto(s) agregado(s) a Inventario, ${data.creadas_compras_bodega} compra(s) nueva(s) en Bodega con ${data.creadas_piezas_bodega} pieza(s).
      </div>`;
  }

  el('btn-cargar-masivo').addEventListener('click', async () => {
    const input = el('cm-archivo');
    const archivo = input.files[0];
    if (!archivo) {
      el('mensaje-carga-masiva').innerHTML = '<div class="mensaje error">Elige primero un archivo Excel (.xlsx).</div>';
      return;
    }
    el('btn-cargar-masivo').disabled = true;
    el('mensaje-carga-masiva').innerHTML = '<div class="mensaje info">Procesando archivo...</div>';
    try {
      const dataUrl = await archivoABase64(archivo);
      const res = await fetch('/api/carga-masiva', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archivo: dataUrl }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        renderResultadoCargaMasiva(data, true);
        return;
      }
      renderResultadoCargaMasiva(data, false);
      input.value = '';
      await cargar();
    } catch (e) {
      el('mensaje-carga-masiva').innerHTML = `<div class="mensaje error">${e.message || 'No se pudo procesar el archivo.'}</div>`;
    } finally {
      el('btn-cargar-masivo').disabled = false;
    }
  });

  window.__sesion.then(async (usuario) => {
    if (!usuario) return;
    usuarioActual = usuario;
    puedeEditar = usuario.rol === 'admin' || usuario.rol === 'mecanico_lider';
    if (puedeEditar) {
      el('card-nuevo').style.display = 'block';
      el('card-carga-masiva').style.display = 'block';
      try {
        const vehiculos = await fetchJSON('/api/vehiculos');
        el('r-vehiculo').innerHTML += vehiculos.map((v) => `<option value="${v.id}">Vehículo ${v.numero ?? '—'}${v.patente ? ` — ${v.patente}` : ''} (${v.marca || ''} ${v.modelo || ''})</option>`).join('');
      } catch (e) { /* nada que hacer si falla, el select queda solo con la opción genérica */ }
    }
    const params = new URLSearchParams(location.search);
    if (params.get('bajo_stock') === '1') el('filtro-bajo-stock').checked = true;
    cargar();
  });
})();
