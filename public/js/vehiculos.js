(function () {
  const el = (id) => document.getElementById(id);
  let vehiculosCache = [];

  // Catálogo de repuestos típicos por categoría — al marcarlos se arma la fila para
  // cargar cantidad/precio/ubicación, igual que si se agregaran a mano desde
  // Inventario, pero todo en el mismo paso en que se registra el vehículo. Si falta
  // alguno en la lista, "+ Otro repuesto" de esa categoría permite agregarlo igual.
  const CATALOGO_REPUESTOS = {
    Motor: ['Block motor', 'Culata', 'Cigüeñal', 'Pistones (juego)', 'Turbo', 'Bomba de agua', 'Bomba de aceite', 'Múltiple de admisión', 'Múltiple de escape', 'Filtro de aceite', 'Correa de distribución'],
    'Tren delantero': ['Caja de cambios', 'Embrague (kit)', 'Diferencial', 'Eje cardán', 'Semiejes (par)', 'Maza delantera (con rodamiento)', 'Mangueta / pivote', 'Rótula', 'Terminal de dirección', 'Barra estabilizadora delantera', 'Amortiguador delantero', 'Resorte / muelle delantero', 'Disco de freno delantero', 'Pastillas de freno delanteras', 'Semieje delantero'],
    'Tren trasero': ['Maza trasera (con rodamiento)', 'Amortiguador trasero', 'Resorte / muelle trasero', 'Barra estabilizadora trasera', 'Disco o tambor de freno trasero', 'Pastillas o balatas traseras', 'Semieje trasero', 'Diferencial trasero'],
    Transmisión: ['Caja de cambios', 'Transfer', 'Cardanes'],
    'Cardán delantero': [],
    'Cardán trasero': [],
    Frenos: ['Disco de freno delantero', 'Disco de freno trasero', 'Pastillas de freno', 'Cilindro maestro', 'Caliper de freno'],
    Eléctrico: ['Alternador', 'Motor de partida', 'Batería', 'Computadora (ECU)', 'Faro delantero', 'Foco trasero', 'Regulador de voltaje'],
    Carrocería: ['Parachoques delantero', 'Parachoques trasero', 'Capot', 'Puerta delantera', 'Puerta trasera', 'Parabrisas', 'Espejo retrovisor', 'Tapa de maletero', 'Guardafango'],
    Interior: ['Asiento delantero', 'Asiento trasero', 'Volante', 'Tablero', 'Radio / equipo de audio', 'Palanca de cambios'],
    Neumáticos: ['Neumático', 'Llanta (aro)'],
    Otro: [],
  };

  // Repuestos que el propio negocio fue agregando con "+ Otro repuesto" en
  // vehículos anteriores (o en este mismo, recién agregados) — se cargan del
  // servidor y se muestran como checkbox arriba de la lista fija de cada
  // categoría, para no tener que escribirlos de nuevo cada vez.
  let catalogoExtra = {};
  // Repuestos (de la lista fija de arriba, o agregados a mano antes) que este
  // negocio sacó de la lista con el botón "Eliminar marcados" porque no le
  // corresponden — no vuelven a mostrarse.
  let catalogoOcultos = {};

  async function cargarCatalogoExtra() {
    try {
      const data = await fetchJSON('/api/catalogo-repuestos');
      catalogoExtra = data.extra || {};
      catalogoOcultos = data.ocultos || {};
    } catch (e) {
      catalogoExtra = {};
      catalogoOcultos = {};
    }
  }

  function estaOculto(categoria, nombre) {
    return (catalogoOcultos[categoria] || []).some((n) => n.toLowerCase() === nombre.toLowerCase());
  }

  // Devuelve las opciones a mostrar como checkbox en una categoría, cada una
  // marcada con si viene de la lista fija del código (esDefault) o fue
  // agregada a mano por el negocio — lo necesita el botón "Eliminar
  // marcados" para saber si debe ocultarla (fija) o borrarla (a mano).
  function opcionesConExtra(categoria) {
    const base = (CATALOGO_REPUESTOS[categoria] || [])
      .filter((n) => !estaOculto(categoria, n))
      .map((n) => ({ nombre: n, esDefault: true }));
    const extra = (catalogoExtra[categoria] || [])
      .filter((n) => !estaOculto(categoria, n) && !base.some((b) => b.nombre.toLowerCase() === n.toLowerCase()))
      .map((n) => ({ nombre: n, esDefault: false }));
    return [...extra, ...base]; // los agregados a mano quedan arriba
  }

  function bloqueCategoria(categoria) {
    return document.querySelector(`.cat-bloque[data-categoria="${CSS.escape(categoria)}"]`);
  }

  function contenedorFilas(categoria) {
    return Array.from(document.querySelectorAll('.cat-filas')).find((c) => c.dataset.filas === categoria);
  }

  function actualizarContador(categoria) {
    const contenedor = contenedorFilas(categoria);
    const contadorEl = document.querySelector(`[data-contador="${categoria}"]`);
    if (contadorEl) contadorEl.textContent = contenedor.children.length;
  }

  function agregarParteFila(categoria, nombre, checkboxEl) {
    const contenedor = contenedorFilas(categoria);
    if (Array.from(contenedor.children).some((f) => f.dataset.nombre === nombre)) return; // ya estaba agregado
    const fila = document.createElement('div');
    fila.className = 'parte-fila';
    fila.dataset.categoria = categoria;
    fila.dataset.nombre = nombre;
    fila.innerHTML = `
      <div class="parte-nombre">${nombre}</div>
      <input type="number" min="1" value="1" class="parte-cantidad" title="Cantidad">
      <input type="number" min="0" value="0" class="parte-precio" title="Precio de venta" placeholder="Precio $">
      <input type="text" class="parte-ubicacion" placeholder="Ubicación (opcional)">
      <button type="button" class="btn secundario pequeno btn-quitar-parte">✕</button>
    `;
    fila.querySelector('.btn-quitar-parte').addEventListener('click', () => {
      fila.remove();
      if (checkboxEl) checkboxEl.checked = false;
      actualizarContador(categoria);
    });
    contenedor.appendChild(fila);
    actualizarContador(categoria);
  }

  function quitarParteFila(categoria, nombre) {
    const contenedor = contenedorFilas(categoria);
    const fila = Array.from(contenedor.children).find((f) => f.dataset.nombre === nombre);
    if (fila) fila.remove();
    actualizarContador(categoria);
  }

  function checkboxesHTML(categoria) {
    const opciones = opcionesConExtra(categoria);
    if (!opciones.length) {
      return '<p class="subtitulo" style="margin:8px 0 0">Todavía no hay repuestos cargados en esta categoría — agrégalos con "+ Otro repuesto" de abajo.</p>';
    }
    const contenedor = contenedorFilas(categoria);
    const yaAgregados = contenedor ? new Set(Array.from(contenedor.children).map((f) => f.dataset.nombre)) : new Set();
    return `<div class="cat-checkboxes">
      ${opciones
        .map(
          (p) =>
            `<label><input type="checkbox" class="parte-checkbox" data-categoria="${categoria}" data-default="${p.esDefault ? '1' : '0'}" value="${p.nombre}" ${yaAgregados.has(p.nombre) ? 'checked' : ''}> ${p.nombre}</label>`
        )
        .join('')}
    </div>`;
  }

  function adjuntarListenersCheckboxes(bloque) {
    bloque.querySelectorAll('.parte-checkbox').forEach((chk) => {
      chk.addEventListener('change', () => {
        if (chk.checked) agregarParteFila(chk.dataset.categoria, chk.value, chk);
        else quitarParteFila(chk.dataset.categoria, chk.value);
      });
    });
  }

  // Reconstruye solo la lista de checkboxes de una categoría (cuando se
  // agrega un repuesto nuevo con "+ Otro repuesto"), sin tocar las filas de
  // cantidad/precio ya cargadas para este vehículo en esa u otras categorías.
  function refrescarCheckboxes(categoria) {
    const bloque = bloqueCategoria(categoria);
    if (!bloque) return;
    const actual = bloque.querySelector('.cat-checkboxes, .subtitulo');
    if (!actual) return;
    actual.outerHTML = checkboxesHTML(categoria);
    adjuntarListenersCheckboxes(bloque);
  }

  function renderCategorias() {
    el('categorias-repuestos').innerHTML = Object.keys(CATALOGO_REPUESTOS)
      .map(
        (cat) => `
      <details class="cat-bloque" data-categoria="${cat}">
        <summary>🔧 ${cat} <span class="cat-contador badge otro" data-contador="${cat}">0</span></summary>
        ${checkboxesHTML(cat)}
        <div class="fila" style="grid-template-columns: 2fr auto; margin-top:8px">
          <input type="text" class="input-otro-repuesto" placeholder="Otro repuesto de ${cat}...">
          <button type="button" class="btn secundario pequeno btn-agregar-otro" data-categoria="${cat}">+ Agregar</button>
        </div>
        <button type="button" class="btn peligro pequeno btn-eliminar-marcados" data-categoria="${cat}" style="margin-top:6px">🗑 Eliminar marcados de la lista</button>
        <div class="cat-filas" data-filas="${cat}"></div>
      </details>`
      )
      .join('');

    adjuntarListenersCheckboxes(el('categorias-repuestos'));
    el('categorias-repuestos').querySelectorAll('.btn-agregar-otro').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const input = btn.previousElementSibling;
        const nombre = input.value.trim();
        if (!nombre) return;
        const categoria = btn.dataset.categoria;
        agregarParteFila(categoria, nombre, null);
        input.value = '';

        const yaEnCatalogo = opcionesConExtra(categoria).some((o) => o.nombre.toLowerCase() === nombre.toLowerCase());
        if (!yaEnCatalogo) {
          // Si estaba oculto, agregarlo de nuevo lo "desoculta" (el servidor
          // hace lo mismo con su propia copia).
          catalogoOcultos[categoria] = (catalogoOcultos[categoria] || []).filter((n) => n.toLowerCase() !== nombre.toLowerCase());
          catalogoExtra[categoria] = [nombre, ...(catalogoExtra[categoria] || [])];
        }
        refrescarCheckboxes(categoria); // ya queda marcado: agregarParteFila() ya creó su fila arriba
        if (!yaEnCatalogo) {
          try {
            await fetchJSON('/api/catalogo-repuestos', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ categoria, nombre }),
            });
          } catch (e) {
            ErpAuth.toast('Se agregó a este vehículo, pero no se pudo guardar en el catálogo para la próxima vez.', 'error');
          }
        }
      });
    });

    el('categorias-repuestos').querySelectorAll('.btn-eliminar-marcados').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const categoria = btn.dataset.categoria;
        const bloque = bloqueCategoria(categoria);
        const marcados = Array.from(bloque.querySelectorAll('.parte-checkbox:checked')).map((chk) => ({
          nombre: chk.value,
          esDefault: chk.dataset.default === '1',
        }));
        if (marcados.length === 0) {
          ErpAuth.toast('Primero marca (tickea) los repuestos que quieres sacar de la lista.', 'error');
          return;
        }
        const listado = marcados.map((m) => `- ${m.nombre}`).join('\n');
        const confirmado = confirm(
          `¿Sacar estos ${marcados.length} repuesto(s) de la lista de "${categoria}"?\n\n${listado}\n\nNo se van a volver a mostrar para elegir en próximos vehículos. Esta acción no se puede deshacer.`
        );
        if (!confirmado) return;

        for (const m of marcados) {
          quitarParteFila(categoria, m.nombre); // si estaba tickeado no se manda como repuesto de este vehículo
          if (m.esDefault) {
            catalogoOcultos[categoria] = [...(catalogoOcultos[categoria] || []), m.nombre];
          } else {
            catalogoExtra[categoria] = (catalogoExtra[categoria] || []).filter((n) => n.toLowerCase() !== m.nombre.toLowerCase());
          }
          try {
            await fetchJSON('/api/catalogo-repuestos', {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ categoria, nombre: m.nombre, es_default: m.esDefault }),
            });
          } catch (e) {
            ErpAuth.toast(`No se pudo sacar "${m.nombre}" de la lista.`, 'error');
          }
        }
        refrescarCheckboxes(categoria);
        ErpAuth.toast('Lista actualizada.', 'exito');
      });
    });
  }

  function recolectarRepuestosVehiculo() {
    const filas = document.querySelectorAll('#categorias-repuestos .parte-fila');
    return Array.from(filas).map((f) => ({
      nombre: f.dataset.nombre,
      categoria: f.dataset.categoria,
      cantidad: Number(f.querySelector('.parte-cantidad').value) || 1,
      precio_venta: Number(f.querySelector('.parte-precio').value) || 0,
      ubicacion: f.querySelector('.parte-ubicacion').value.trim(),
    }));
  }

  function badgeEstado(estado) {
    const label = estado === 'en_desarme' ? 'En desarme' : 'Desarmado';
    return `<span class="badge ${estado}">${label}</span>`;
  }

  function render() {
    const filtro = el('filtro-estado').value;
    const data = filtro ? vehiculosCache.filter((v) => v.estado === filtro) : vehiculosCache;
    if (data.length === 0) {
      el('lista-vehiculos').innerHTML = '<p class="vacio">No hay vehículos para este filtro.</p>';
      return;
    }
    el('lista-vehiculos').innerHTML = `
      <div class="tabla-scroll">
      <table>
        <thead><tr><th>N°</th><th>Patente</th><th>Marca / Modelo</th><th>Año</th><th>Km</th><th>Costo compra</th><th>Valor motor</th><th>Estado</th><th>Ingreso</th><th></th></tr></thead>
        <tbody>
          ${data
            .map(
              (v) => `
            <tr>
              <td><span class="badge otro">Vehículo ${v.numero ?? '—'}</span></td>
              <td><strong>${v.patente || '—'}</strong></td>
              <td>${v.marca || ''} ${v.modelo || ''}</td>
              <td>${v.anio || '—'}</td>
              <td>${v.kilometraje ? fmtNum.format(v.kilometraje) : '—'}</td>
              <td><input type="number" min="0" class="edit-costo" data-id="${v.id}" value="${v.costo_compra || 0}" style="width:110px"></td>
              <td><input type="number" min="0" class="edit-valor-motor" data-id="${v.id}" value="${v.valor_motor_referencia || 0}" style="width:110px"></td>
              <td>${badgeEstado(v.estado)}</td>
              <td>${new Date(v.fecha_ingreso).toLocaleDateString('es-CL')}</td>
              <td>
                <button class="btn secundario pequeno" data-ver="${v.id}">Ver repuestos</button>
                ${v.estado === 'en_desarme' ? `<button class="btn exito pequeno" data-desarmar="${v.id}">✓ Desarmado</button>` : ''}
              </td>
            </tr>`
            )
            .join('')}
        </tbody>
      </table>
      </div>`;

    el('lista-vehiculos').querySelectorAll('[data-ver]').forEach((btn) => {
      btn.addEventListener('click', () => verDetalle(btn.dataset.ver));
    });
    el('lista-vehiculos').querySelectorAll('[data-desarmar]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await fetchJSON(`/api/vehiculos/${btn.dataset.desarmar}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ estado: 'desarmado' }),
        });
        await cargar();
      });
    });

    // Costo de compra y valor del motor de referencia: editables en la misma
    // tabla, con guardado automático (debounce) igual que en Inventario.
    let temporizadorVehiculo = null;
    const guardarVehiculo = (id, campo, valor) => {
      clearTimeout(temporizadorVehiculo);
      temporizadorVehiculo = setTimeout(async () => {
        try {
          await fetchJSON(`/api/vehiculos/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ [campo]: valor }),
          });
        } catch (e) {
          alert(`No se pudo guardar: ${e.message}`);
        }
      }, 500);
    };
    el('lista-vehiculos').querySelectorAll('.edit-costo').forEach((inp) => {
      inp.addEventListener('change', () => guardarVehiculo(inp.dataset.id, 'costo_compra', Number(inp.value) || 0));
    });
    el('lista-vehiculos').querySelectorAll('.edit-valor-motor').forEach((inp) => {
      inp.addEventListener('change', () => guardarVehiculo(inp.dataset.id, 'valor_motor_referencia', Number(inp.value) || 0));
    });
  }

  async function verDetalle(id) {
    const vehiculo = await fetchJSON(`/api/vehiculos/${id}`);
    el('detalle-patente').textContent = `Vehículo ${vehiculo.numero ?? '—'}${vehiculo.patente ? ` — ${vehiculo.patente}` : ''}`;
    if (vehiculo.repuestos.length === 0) {
      el('detalle-repuestos').innerHTML = '<p class="vacio">Todavía no se ha cargado ningún repuesto de este vehículo. Agrégalos desde Inventario, eligiendo este vehículo en el desplegable.</p>';
    } else {
      el('detalle-repuestos').innerHTML = `
        <div class="tabla-scroll">
        <table>
          <thead><tr><th>Repuesto</th><th>Categoría</th><th>Stock</th><th>Precio venta</th></tr></thead>
          <tbody>
            ${vehiculo.repuestos
              .map((r) => `<tr><td>${r.nombre}</td><td>${r.categoria || '—'}</td><td>${r.cantidad_disponible}</td><td>${fmtCLP.format(r.precio_venta)}</td></tr>`)
              .join('')}
          </tbody>
        </table>
        </div>
        <p style="margin-top:10px"><a href="/inventario.html" class="btn secundario pequeno">+ Agregar otro repuesto de este vehículo</a></p>`;
    }
    el('card-detalle').style.display = 'block';
    el('card-detalle').scrollIntoView({ behavior: 'smooth' });
  }

  el('btn-cerrar-detalle').addEventListener('click', () => { el('card-detalle').style.display = 'none'; });
  el('filtro-estado').addEventListener('change', render);

  // ---------- Numeración de vehículos: sugerencia automática (+1) o manual ----------
  function proximoNumeroSugerido() {
    return vehiculosCache.reduce((max, v) => Math.max(max, Number(v.numero) || 0), 0) + 1;
  }

  function actualizarNumeracion() {
    if (!el('v-numero-manual').checked) {
      el('v-numero').value = proximoNumeroSugerido();
    }
    if (vehiculosCache.length === 0) {
      el('v-ultimo-ingreso').value = 'Ninguno todavía';
    } else {
      const ultimo = vehiculosCache.reduce((a, b) => ((Number(a.numero) || 0) >= (Number(b.numero) || 0) ? a : b));
      el('v-ultimo-ingreso').value = `Vehículo ${ultimo.numero}${ultimo.patente ? ` — ${ultimo.patente}` : ''}`;
    }
  }

  el('v-numero-manual').addEventListener('change', () => {
    el('v-numero').disabled = !el('v-numero-manual').checked;
    if (!el('v-numero-manual').checked) actualizarNumeracion();
  });

  el('btn-crear-vehiculo').addEventListener('click', async () => {
    const repuestos = recolectarRepuestosVehiculo();
    el('btn-crear-vehiculo').disabled = true;
    try {
      const vehiculo = await fetchJSON('/api/vehiculos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          marca: el('v-marca').value.trim(),
          modelo: el('v-modelo').value.trim(),
          anio: el('v-anio').value ? Number(el('v-anio').value) : null,
          // Solo se manda "numero" si se marcó "Asignar manualmente" — si no,
          // se omite del JSON (undefined) y el servidor asigna el siguiente
          // automático (MAX(numero)+1 del negocio).
          numero: el('v-numero-manual').checked ? Number(el('v-numero').value) || undefined : undefined,
          origen: el('v-origen').value.trim(),
          observaciones: el('v-obs').value.trim(),
          costo_compra: el('v-costo').value ? Number(el('v-costo').value) : 0,
          valor_motor_referencia: el('v-valor-motor').value ? Number(el('v-valor-motor').value) : 0,
        }),
      });

      // Cada repuesto marcado queda cargado al inventario, ligado a este vehículo,
      // en el mismo paso — sin tener que ir después a Inventario a agregarlo a mano.
      let agregados = 0;
      let fallidos = 0;
      for (const r of repuestos) {
        try {
          await fetchJSON('/api/inventario', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              vehiculo_id: vehiculo.id,
              nombre: r.nombre,
              categoria: r.categoria,
              cantidad_disponible: r.cantidad,
              cantidad_minima: 1,
              precio_venta: r.precio_venta,
              ubicacion: r.ubicacion,
            }),
          });
          agregados += 1;
        } catch (e) {
          fallidos += 1;
        }
      }

      ['v-marca', 'v-modelo', 'v-anio', 'v-origen', 'v-obs', 'v-costo', 'v-valor-motor'].forEach((id) => (el(id).value = ''));
      el('v-numero-manual').checked = false;
      el('v-numero').disabled = true;
      renderCategorias();
      const resumenRepuestos = repuestos.length === 0
        ? ' Todavía no le agregaste repuestos — puedes hacerlo después desde Inventario.'
        : ` Se cargaron ${agregados} repuesto(s) al inventario.${fallidos ? ` (${fallidos} no se pudieron guardar)` : ''}`;
      el('mensaje-vehiculo').innerHTML = `<div class="mensaje exito">✅ Vehículo registrado.${resumenRepuestos}</div>`;
      await cargar();
    } catch (e) {
      el('mensaje-vehiculo').innerHTML = `<div class="mensaje error">${e.message}</div>`;
    } finally {
      el('btn-crear-vehiculo').disabled = false;
    }
  });

  async function cargar() {
    vehiculosCache = await fetchJSON('/api/vehiculos');
    render();
    actualizarNumeracion();
  }

  window.__sesion.then(async (usuario) => {
    if (!usuario) return;
    await cargarCatalogoExtra();
    renderCategorias();
    cargar();
  });
})();
