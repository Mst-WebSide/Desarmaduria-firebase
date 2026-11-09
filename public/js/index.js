(function () {
  const el = (id) => document.getElementById(id);

  const ACCESOS = [
    { href: '/vehiculos.html', icono: '🚗', titulo: 'Vehículos ingresados', desc: 'Registrar un auto que llega para desarmar y ver su estado.', roles: ['admin', 'mecanico_lider'] },
    { href: '/taller.html', icono: '🔧', titulo: 'Taller mecánico', desc: 'Ingresar un vehículo a reparación, armar su presupuesto y documentar la entrega con PDF.', roles: ['admin', 'mecanico_lider'] },
    { href: '/inventario.html', icono: '📦', titulo: 'Inventario de repuestos', desc: 'Ver stock, agregar repuestos nuevos y su ubicación.', roles: null },
    { href: '/bodega.html', icono: '🏬', titulo: 'Inventario Bodega (Compra directa)', desc: 'Repuestos comprados aparte (no de un vehículo desarmado), con su propia numeración y repisa/fila.', roles: null },
    { href: '/ventas.html', icono: '🧾', titulo: 'Vender un repuesto', desc: 'Registrar una venta, elegir tipo de pago y emitir el ticket.', roles: null },
    { href: '/dashboard.html', icono: '📊', titulo: 'Panel de ventas', desc: 'Ventas totales, por mes, por tipo de repuesto y por tipo de pago.', roles: ['admin'] },
    { href: '/marketplace.html', icono: '🤝', titulo: 'Mercado entre negocios', desc: 'Buscar un repuesto en otras desarmadurías y chatear con ellas.', roles: ['admin', 'mecanico_lider', 'vendedor'] },
    { href: '/auditoria.html', icono: '🕵️', titulo: 'Trazabilidad', desc: 'Quién vendió qué, a quién y cuándo, y la bitácora de toda la actividad.', roles: ['admin'] },
    { href: '/admin.html', icono: '⚙️', titulo: 'Administración', desc: 'Usuarios de tu negocio y datos de contacto.', roles: ['admin'] },
  ];

  window.__sesion.then(async (usuario) => {
    if (!usuario) return;
    el('titulo-saludo').textContent = `Hola, ${usuario.nombre.split(' ')[0]} 👋`;
    el('subtitulo-negocio').textContent = `${usuario.negocio.nombre} — ${ErpAuth.ROL_LABEL[usuario.rol] || usuario.rol}`;

    el('accesos').innerHTML = ACCESOS.filter((a) => !a.roles || a.roles.includes(usuario.rol))
      .map(
        (a) => `
        <a class="accion-tile" href="${a.href}">
          <div class="icono">${a.icono}</div>
          <h3>${a.titulo}</h3>
          <p>${a.desc}</p>
        </a>`
      )
      .join('');

    if (usuario.rol === 'admin') {
      const resumen = await fetchJSON('/api/reportes/resumen');
      el('stats-rapidas').innerHTML = [
        ['Ventas totales', fmtNum.format(resumen.totalVentas)],
        ['Monto total vendido', fmtCLP.format(resumen.montoTotal)],
        ['Ventas hoy', fmtNum.format(resumen.ventasHoy)],
        ['Vehículos en desarme', fmtNum.format(resumen.vehiculosEnDesarme)],
        ['Repuestos en inventario', fmtNum.format(resumen.totalRepuestos)],
        ['Costo total de vehículos', fmtCLP.format(resumen.costoTotalVehiculos)],
        ['Ganancia total de vehículos', fmtCLP.format(resumen.gananciaTotalVehiculos)],
      ]
        .map(([label, val]) => `<div class="card stat"><div class="valor">${val}</div><div class="etiqueta">${label}</div></div>`)
        .join('') +
        (resumen.bajoStock > 0
          ? `<a class="card stat" href="/inventario.html?bajo_stock=1" style="text-decoration:none; border:1px solid var(--rojo)"><div class="valor" style="color:var(--rojo)">${resumen.bajoStock}</div><div class="etiqueta">Repuestos con stock bajo</div></a>`
          : '');
    }
  });
})();
