(function () {
  const el = (id) => document.getElementById(id);
  const PALETA = ['#d81d2b', '#17181c', '#ea580c', '#16a34a', '#7c3aed', '#2563eb', '#d97706', '#0891b2', '#be185d'];
  const TIPO_PAGO_LABEL = { efectivo: 'Efectivo', tarjeta_debito: 'Tarjeta débito', tarjeta_credito: 'Tarjeta crédito', transferencia: 'Transferencia', otro: 'Otro' };
  let rangoActual = 'todo';
  let tipoGraficoActual = 'circular'; // 'circular' | 'barras' | 'lineal' — solo afecta los gráficos "Tipo de pago" y "Ventas por tipo de repuesto" (los que parten siendo circulares); "Ventas por mes" se queda siempre en barras.
  let charts = {}; // guardamos las instancias de Chart.js para poder destruirlas al cambiar el filtro

  function conRango(url) {
    return `${url}${url.includes('?') ? '&' : '?'}rango=${rangoActual}`;
  }

  // Traduce el selector de estilo a un tipo real de Chart.js. "circularOriginal"
  // es el tipo que ese gráfico en particular tenía cuando el estilo es
  // "circular" (doughnut para Tipo de pago, pie para Ventas por categoría).
  function tipoChartJS(circularOriginal) {
    if (tipoGraficoActual === 'barras') return 'bar';
    if (tipoGraficoActual === 'lineal') return 'line';
    return circularOriginal;
  }

  // Arma el dataset según el estilo elegido: en circular/barras cada
  // categoría tiene su propio color (PALETA); en líneas se dibuja una sola
  // línea roja con un punto de color por categoría, más el área rellena
  // suave para que se note la forma.
  function datasetSegunTipo(valores) {
    if (tipoGraficoActual === 'lineal') {
      return {
        data: valores,
        borderColor: '#d81d2b',
        backgroundColor: 'rgba(216,29,43,0.15)',
        pointBackgroundColor: PALETA,
        pointBorderColor: '#fff',
        pointRadius: 5,
        pointHoverRadius: 7,
        borderWidth: 2,
        tension: 0.3,
        fill: true,
      };
    }
    return { data: valores, backgroundColor: PALETA, borderRadius: tipoGraficoActual === 'barras' ? 5 : 0 };
  }

  // Con barras/líneas hace falta un eje Y (con formato de plata) y no tiene
  // sentido la leyenda de colores por categoría (ya se ven en el eje X); en
  // circular es al revés: sin ejes, pero con la leyenda abajo.
  function opcionesSegunTipo() {
    const esCircular = tipoGraficoActual === 'circular';
    return {
      legend: esCircular ? { position: 'bottom' } : { display: false },
      scales: esCircular ? undefined : { y: { ticks: { callback: (v) => fmtCLP.format(v) } } },
    };
  }

  // ctx.parsed es un número en pie/doughnut, y {x, y} en barras/líneas — con
  // esto se lee el valor sin importar el tipo de gráfico activo.
  function valorTooltip(ctx) {
    return ctx.parsed && ctx.parsed.y !== undefined ? ctx.parsed.y : ctx.parsed;
  }

  async function cargarResumen() {
    const r = await fetchJSON(conRango('/api/reportes/resumen'));
    const stats = [
      { label: 'Ventas totales', val: r.totalVentas, fmt: fmtNum },
      { label: 'Monto total vendido', val: r.montoTotal, fmt: fmtCLP, comparacion: r.comparacion },
      { label: 'Ventas hoy', val: r.ventasHoy, fmt: fmtNum },
      { label: 'Vehículos en desarme', val: r.vehiculosEnDesarme, fmt: fmtNum },
      { label: 'Repuestos en inventario', val: r.totalRepuestos, fmt: fmtNum },
      { label: 'Costo total de vehículos', val: r.costoTotalVehiculos, fmt: fmtCLP },
      { label: 'Ganancia total de vehículos', val: r.gananciaTotalVehiculos, fmt: fmtCLP },
    ];
    let html = stats
      .map(
        (s, i) => `
      <div class="card stat" style="animation-delay:${i * 0.05}s">
        <div class="valor" id="stat-valor-${i}">0</div>
        <div class="etiqueta">${s.label}</div>
        ${
          s.comparacion
            ? `<div class="comparacion ${s.comparacion.subida ? 'subida' : 'bajada'}">${s.comparacion.subida ? '▲' : '▼'} ${Math.abs(s.comparacion.porcentaje)}% vs. periodo anterior</div>`
            : ''
        }
      </div>`
      )
      .join('');
    // Importante: se arma el HTML completo (incluida la tarjeta de stock bajo)
    // ANTES de tocar innerHTML una sola vez — si se usara "+=" acá, el navegador
    // re-parsearía todo el bloque y reemplazaría los nodos de #stat-valor-N,
    // dejando la animación de conteo corriendo sobre elementos ya desconectados.
    if (r.bajoStock > 0) {
      html += `<a class="card stat" href="/inventario.html?bajo_stock=1" style="text-decoration:none; border:1px solid var(--rojo)"><div class="valor" style="color:var(--rojo)">${r.bajoStock}</div><div class="etiqueta">Repuestos con stock bajo</div></a>`;
    }
    el('stats-resumen').innerHTML = html;
    stats.forEach((s, i) => ErpAuth.animarNumero(el(`stat-valor-${i}`), s.val, (v) => s.fmt.format(Math.round(v))));
  }

  function mesLabel(mes) {
    const [anio, m] = mes.split('-');
    const nombres = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    return `${nombres[Number(m) - 1]} ${anio}`;
  }

  function destruir(clave) {
    if (charts[clave]) { charts[clave].destroy(); charts[clave] = null; }
  }

  async function cargarGraficoMes() {
    const data = await fetchJSON('/api/reportes/ventas-por-mes');
    destruir('mes');
    charts.mes = new Chart(el('grafico-mes'), {
      type: 'bar',
      data: {
        labels: data.map((d) => mesLabel(d.mes)),
        datasets: [
          {
            label: 'Monto vendido',
            data: data.map((d) => d.total),
            backgroundColor: '#d81d2b',
            borderRadius: 5,
          },
        ],
      },
      options: {
        responsive: true,
        animation: { duration: 500, easing: 'easeOutCubic' },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx) => fmtCLP.format(ctx.parsed.y) } },
        },
        scales: {
          y: { ticks: { callback: (v) => fmtCLP.format(v) } },
        },
      },
    });
  }

  async function cargarGraficoPago() {
    const data = await fetchJSON(conRango('/api/reportes/ventas-por-tipo-pago'));
    destruir('pago');
    const { legend, scales } = opcionesSegunTipo();
    charts.pago = new Chart(el('grafico-pago'), {
      type: tipoChartJS('doughnut'),
      data: {
        labels: data.map((d) => TIPO_PAGO_LABEL[d.tipo_pago] || d.tipo_pago),
        datasets: [{ ...datasetSegunTipo(data.map((d) => d.monto_total)) }],
      },
      options: {
        responsive: true,
        animation: { duration: 500, easing: 'easeOutCubic' },
        plugins: {
          legend,
          tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${fmtCLP.format(valorTooltip(ctx))}` } },
        },
        scales,
      },
    });
  }

  async function cargarGraficoCategoria() {
    const data = await fetchJSON(conRango('/api/reportes/ventas-por-categoria'));
    destruir('categoria');
    if (data.length === 0) {
      el('grafico-categoria').hidden = true;
      el('grafico-categoria-vacio').hidden = false;
      return;
    }
    el('grafico-categoria').hidden = false;
    el('grafico-categoria-vacio').hidden = true;
    const { legend, scales } = opcionesSegunTipo();
    charts.categoria = new Chart(el('grafico-categoria'), {
      type: tipoChartJS('pie'),
      data: {
        labels: data.map((d) => d.categoria || 'Sin categoría'),
        datasets: [{ ...datasetSegunTipo(data.map((d) => d.monto_total)) }],
      },
      options: {
        responsive: true,
        animation: { duration: 500, easing: 'easeOutCubic' },
        plugins: {
          legend,
          tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${fmtCLP.format(valorTooltip(ctx))} (${data[ctx.dataIndex].cantidad} unid.)` } },
        },
        scales,
      },
    });
  }

  async function cargarTopRepuestos() {
    const data = await fetchJSON(conRango('/api/reportes/top-repuestos'));
    if (data.length === 0) {
      el('tabla-top-repuestos').innerHTML = '<p class="vacio">Todavía no hay ventas registradas.</p>';
      return;
    }
    el('tabla-top-repuestos').innerHTML = `
      <div class="tabla-scroll">
      <table>
        <thead><tr><th>Repuesto</th><th>Cantidad</th><th>Monto total</th></tr></thead>
        <tbody>
          ${data.map((r) => `<tr><td>${r.nombre_repuesto}</td><td>${fmtNum.format(r.cantidad)}</td><td>${fmtCLP.format(r.monto_total)}</td></tr>`).join('')}
        </tbody>
      </table>
      </div>`;
  }

  async function cargarVentas() {
    const ventas = await fetchJSON('/api/ventas');
    if (ventas.length === 0) {
      el('tabla-ventas').innerHTML = '<p class="vacio">Todavía no hay ventas registradas.</p>';
      return;
    }
    el('tabla-ventas').innerHTML = `
      <div class="tabla-scroll">
      <table>
        <thead><tr><th>#</th><th>Fecha</th><th>Vendedor</th><th>Cliente</th><th>Repuestos</th><th>Total</th><th>Pago</th><th>Estado</th></tr></thead>
        <tbody>
          ${ventas
            .map(
              (v) => `
            <tr>
              <td>${v.id}</td>
              <td>${new Date(v.fecha).toLocaleString('es-CL')}</td>
              <td>${v.vendedor_nombre}</td>
              <td>${v.cliente_nombre || '—'}</td>
              <td>${v.items.map((it) => `${it.cantidad}× ${it.nombre_repuesto}${it.origen === 'bodega' ? ' <span class="badge bodega">Bodega</span>' : ''}`).join(', ')}</td>
              <td>${fmtCLP.format(v.total)}</td>
              <td><span class="badge ${v.tipo_pago}">${TIPO_PAGO_LABEL[v.tipo_pago] || v.tipo_pago}</span></td>
              <td><span class="badge ${v.estado}">${v.estado}</span></td>
            </tr>`
            )
            .join('')}
        </tbody>
      </table>
      </div>`;
  }

  async function cargarSegunRango() {
    await Promise.all([cargarResumen(), cargarGraficoPago(), cargarGraficoCategoria(), cargarTopRepuestos()]);
  }

  window.__sesion.then(async (usuario) => {
    if (!usuario) return;
    el('filtro-rango').addEventListener('change', (e) => {
      rangoActual = e.target.value;
      cargarSegunRango();
    });
    el('selector-tipo-grafico').querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.dataset.tipo === tipoGraficoActual) return;
        tipoGraficoActual = btn.dataset.tipo;
        el('selector-tipo-grafico').querySelectorAll('button').forEach((b) => b.classList.toggle('activo', b === btn));
        Promise.all([cargarGraficoPago(), cargarGraficoCategoria()]);
      });
    });
    await Promise.all([cargarSegunRango(), cargarGraficoMes(), cargarVentas()]);
  });
})();
