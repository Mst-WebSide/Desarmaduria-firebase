// Barra superior con menú desplegable + control de sesión, compartido por
// todas las páginas. Cada página solo necesita:
//
//   <div id="app-topbar"></div>
//   ...
//   <script src="/js/common.js"></script>
//   <script>window.__sesion = ErpAuth.iniciarSesionBar(['admin']); // o null = cualquier rol logueado</script>
//
// iniciarSesionBar() arma el menú según el rol de quien inició sesión,
// redirige a /login.html si no hay sesión, y a /index.html si el rol no
// tiene acceso a esa página. Devuelve una promesa con los datos del usuario.
const ErpAuth = (function () {
  const MENU = [
    { href: '/index.html', icono: '🏠', label: 'Inicio', roles: null },
    { href: '/vehiculos.html', icono: '🚗', label: 'Vehículos ingresados', roles: ['admin', 'mecanico_lider'] },
    { href: '/taller.html', icono: '🔧', label: 'Taller mecánico', roles: ['admin', 'mecanico_lider'] },
    { href: '/inventario.html', icono: '📦', label: 'Inventario de repuestos', roles: null },
    { href: '/bodega.html', icono: '🏬', label: 'Inventario Bodega (Compra directa)', roles: null },
    { href: '/ventas.html', icono: '🧾', label: 'Vender / Ventas', roles: null },
    { href: '/dashboard.html', icono: '📊', label: 'Panel de ventas (gráficos)', roles: ['admin'] },
    { href: '/marketplace.html', icono: '🤝', label: 'Mercado entre negocios', roles: ['admin', 'mecanico_lider', 'vendedor'] },
    { href: '/auditoria.html', icono: '🕵️', label: 'Trazabilidad', roles: ['admin'] },
    { href: '/admin.html', icono: '⚙️', label: 'Administración', roles: ['admin'] },
  ];

  const ROL_LABEL = { admin: 'Administrador', mecanico_lider: 'Mecánico líder', mecanico: 'Mecánico', vendedor: 'Vendedor' };

  async function obtenerUsuario() {
    const res = await fetch('/api/auth/me');
    if (!res.ok) return null;
    return res.json();
  }

  function construirTopbar(usuario) {
    const contenedor = document.getElementById('app-topbar');
    if (!contenedor) return;
    const rutaActual = location.pathname;
    const opciones = MENU.filter((m) => !m.roles || m.roles.includes(usuario.rol));

    contenedor.innerHTML = `
      <header class="topbar">
        <div class="titulo">
          <a href="/index.html" class="marca"><img src="/img/logo.png" alt="Logo" class="logo-topbar"> ERP Desarmaduría</a>
          <span class="negocio">${usuario.negocio.nombre}</span>
        </div>
        <div class="lado-derecho">
          <div class="usuario-info">
            ${usuario.nombre}
            <span class="rol">${ROL_LABEL[usuario.rol] || usuario.rol}</span>
          </div>
          <div class="menu-desplegable" id="menu-desplegable">
            <button type="button" class="btn-menu" id="btn-abrir-menu">☰ Menú</button>
            <div class="panel">
              ${opciones
                .map(
                  (o) =>
                    `<a href="${o.href}" class="${o.href === rutaActual ? 'activo' : ''}">${o.icono} ${o.label}</a>`
                )
                .join('')}
              <div class="separador"></div>
              <a href="/cambiar-password.html">🔑 Cambiar mi contraseña</a>
              <a href="#" class="salir" id="link-cerrar-sesion">🚪 Cerrar sesión</a>
            </div>
          </div>
        </div>
      </header>
      <div id="banner-password-temporal"></div>
    `;

    const menu = document.getElementById('menu-desplegable');
    document.getElementById('btn-abrir-menu').addEventListener('click', (e) => {
      e.stopPropagation();
      menu.classList.toggle('abierto');
    });
    document.addEventListener('click', (e) => {
      if (!menu.contains(e.target)) menu.classList.remove('abierto');
    });
    document.getElementById('link-cerrar-sesion').addEventListener('click', async (e) => {
      e.preventDefault();
      await fetch('/api/auth/logout', { method: 'POST' });
      location.href = '/login.html';
    });

    if (usuario.debe_cambiar_password) {
      document.getElementById('banner-password-temporal').innerHTML = `
        <div class="mensaje info" style="border-radius:0; margin:0; text-align:center">
          Estás usando una contraseña temporal. Por seguridad, <a href="/cambiar-password.html"><strong>cámbiala aquí</strong></a>.
        </div>`;
    }
  }

  function toast(mensaje, tipo) {
    tipo = tipo || 'info';
    let cont = document.getElementById('toast-contenedor');
    if (!cont) {
      cont = document.createElement('div');
      cont.id = 'toast-contenedor';
      document.body.appendChild(cont);
    }
    const nodo = document.createElement('div');
    nodo.className = `toast toast-${tipo}`;
    nodo.textContent = mensaje;
    cont.appendChild(nodo);
    setTimeout(() => nodo.classList.add('saliendo'), 3200);
    setTimeout(() => nodo.remove(), 3600);
  }

  function animarNumero(elemento, valorFinal, formatFn) {
    if (!elemento) return;
    const duracion = 650;
    const inicio = performance.now();
    const fmt = formatFn || ((v) => Math.round(v).toString());
    function paso(ahora) {
      const t = Math.min(1, (ahora - inicio) / duracion);
      const avance = 1 - Math.pow(1 - t, 3); // ease-out cúbico
      elemento.textContent = fmt(valorFinal * avance);
      if (t < 1) requestAnimationFrame(paso);
      else elemento.textContent = fmt(valorFinal);
    }
    requestAnimationFrame(paso);
  }

  // Lightbox simple para ver una foto ampliada (usado por las miniaturas de
  // repuestos en inventario, ventas, marketplace y vehículos). Se crea una
  // sola vez y se reutiliza en toda la página.
  function verFotoAmpliada(src) {
    let overlay = document.getElementById('lightbox-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'lightbox-overlay';
      overlay.className = 'lightbox-overlay';
      overlay.innerHTML = '<img class="lightbox-img" alt="Foto ampliada">';
      overlay.addEventListener('click', () => overlay.classList.remove('abierto'));
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') overlay.classList.remove('abierto');
      });
      document.body.appendChild(overlay);
    }
    overlay.querySelector('.lightbox-img').src = src;
    overlay.classList.add('abierto');
  }

  function iniciarSesionBar(rolesPermitidos) {
    return obtenerUsuario().then((usuario) => {
      if (!usuario) {
        location.href = '/login.html';
        return null;
      }
      if (rolesPermitidos && !rolesPermitidos.includes(usuario.rol)) {
        location.href = '/index.html';
        return null;
      }
      construirTopbar(usuario);
      return usuario;
    });
  }

  return { iniciarSesionBar, ROL_LABEL, toast, animarNumero, verFoto: verFotoAmpliada };
})();

async function fetchJSON(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const error = new Error(data.error || `Error ${res.status}`);
    error.status = res.status;
    throw error;
  }
  if (res.status === 204) return null;
  return res.json();
}

const fmtCLP = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 });
const fmtNum = new Intl.NumberFormat('es-CL');
