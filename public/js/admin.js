(function () {
  const el = (id) => document.getElementById(id);
  const ROL_LABEL = { admin: 'Administrador', mecanico_lider: 'Mecánico líder', mecanico: 'Mecánico', vendedor: 'Vendedor' };
  const ROLES_OPCIONES = [
    ['mecanico', 'Mecánico (solo vende)'],
    ['vendedor', 'Vendedor (inventario, bodega, ventas y mercado)'],
    ['mecanico_lider', 'Mecánico líder (ingresa vehículos/repuestos y vende)'],
    ['admin', 'Administrador (acceso completo)'],
  ];

  async function cargarNegocio() {
    const me = await fetchJSON('/api/auth/me');
    el('n-nombre').value = me.negocio.nombre || '';
    el('n-rut').value = me.negocio.rut || '';
    el('n-telefono').value = me.negocio.telefono_dueno || '';
    el('n-email').value = me.negocio.email_contacto || '';
    el('n-direccion').value = me.negocio.direccion || '';
  }

  el('btn-guardar-negocio').addEventListener('click', async () => {
    if (!el('n-nombre').value.trim()) {
      el('mensaje-negocio').innerHTML = '<div class="mensaje error">El nombre del negocio no puede quedar vacío.</div>';
      return;
    }
    el('btn-guardar-negocio').disabled = true;
    try {
      await fetchJSON('/api/negocio', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nombre: el('n-nombre').value.trim(),
          rut: el('n-rut').value.trim(),
          telefono_dueno: el('n-telefono').value.trim(),
          email_contacto: el('n-email').value.trim(),
          direccion: el('n-direccion').value.trim(),
        }),
      });
      el('mensaje-negocio').innerHTML = '<div class="mensaje exito">✅ Datos guardados.</div>';
      // El nombre también se muestra en la barra superior — se actualiza acá
      // mismo para que se note al toque, sin tener que recargar la página.
      const spanNegocio = document.querySelector('#app-topbar .negocio');
      if (spanNegocio) spanNegocio.textContent = el('n-nombre').value.trim();
    } catch (e) {
      el('mensaje-negocio').innerHTML = `<div class="mensaje error">${e.message}</div>`;
    } finally {
      el('btn-guardar-negocio').disabled = false;
    }
  });

  async function cargarUsuarios() {
    const usuarios = await fetchJSON('/api/usuarios');
    el('lista-usuarios').innerHTML = `
      <div class="tabla-scroll">
      <table>
        <thead><tr><th>Nombre</th><th>Usuario</th><th>Rol</th><th>Estado</th><th></th></tr></thead>
        <tbody>
          ${usuarios
            .map(
              (u) => `
            <tr>
              <td>${u.nombre}</td>
              <td><code>${u.usuario}</code>${u.debe_cambiar_password ? ' <small style="color:var(--gris-600)">(pass. temporal)</small>' : ''}</td>
              <td><span class="badge ${u.rol}">${ROL_LABEL[u.rol] || u.rol}</span></td>
              <td>${u.activo ? '<span class="badge desarmado">Activo</span>' : '<span class="badge anulada">Inactivo</span>'}</td>
              <td>
                <button class="btn secundario pequeno" data-gestionar="${u.id}">Gestionar</button>
              </td>
            </tr>
            <tr class="fila-gestionar" id="gestionar-${u.id}" style="display:none">
              <td colspan="5">
                <div class="card" style="margin:8px 0; background:var(--gris-100)">
                  <div class="fila" style="grid-template-columns: 1fr 1fr 1fr; align-items:end">
                    <div>
                      <label>Rol</label>
                      <select data-rol-select="${u.id}">
                        ${ROLES_OPCIONES.map(([v, label]) => `<option value="${v}" ${v === u.rol ? 'selected' : ''}>${label}</option>`).join('')}
                      </select>
                    </div>
                    <div><button class="btn secundario pequeno" data-guardar-rol="${u.id}">Guardar rol</button></div>
                    <div><button class="btn ${u.activo ? 'peligro' : 'exito'} pequeno" data-toggle="${u.id}" data-valor="${u.activo ? 0 : 1}">${u.activo ? 'Desactivar' : 'Activar'}</button></div>
                  </div>
                  <div class="fila" style="grid-template-columns: 1fr 1fr; align-items:end; margin-top:10px">
                    <div>
                      <label>Escribir una contraseña nueva</label>
                      <input type="text" data-pass-input="${u.id}" placeholder="Mínimo 6 caracteres" minlength="6">
                    </div>
                    <div>
                      <button class="btn secundario pequeno" data-guardar-pass="${u.id}">Guardar esta contraseña</button>
                      <button class="btn secundario pequeno" data-resetear="${u.id}">Generar automática</button>
                    </div>
                  </div>
                  <div class="fila" style="grid-template-columns: 1fr 1fr; align-items:end; margin-top:10px">
                    <div>
                      <label>Ver la contraseña actual (pide tu propia contraseña de admin)</label>
                      <input type="password" data-ver-pass-admin="${u.id}" placeholder="Tu contraseña">
                    </div>
                    <div><button class="btn secundario pequeno" data-ver-pass="${u.id}">Ver contraseña</button></div>
                  </div>
                  <div id="resultado-gestion-${u.id}"></div>
                </div>
              </td>
            </tr>`
            )
            .join('')}
        </tbody>
      </table>
      </div>`;

    el('lista-usuarios').querySelectorAll('[data-gestionar]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const fila = el(`gestionar-${btn.dataset.gestionar}`);
        fila.style.display = fila.style.display === 'none' ? '' : 'none';
      });
    });

    el('lista-usuarios').querySelectorAll('[data-resetear]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('¿Restablecer la contraseña de este usuario con una generada automáticamente?')) return;
        const r = await fetchJSON(`/api/usuarios/${btn.dataset.resetear}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ resetPassword: true }),
        });
        alert(`Nueva contraseña temporal: ${r.passwordTemporal}\n\nCompártela con la persona — se le va a pedir que la cambie al iniciar sesión.`);
        await cargarUsuarios();
      });
    });

    el('lista-usuarios').querySelectorAll('[data-toggle]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await fetchJSON(`/api/usuarios/${btn.dataset.toggle}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ activo: Number(btn.dataset.valor) }),
        });
        await cargarUsuarios();
      });
    });

    el('lista-usuarios').querySelectorAll('[data-guardar-rol]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.guardarRol;
        const select = el('lista-usuarios').querySelector(`[data-rol-select="${id}"]`);
        const destino = el(`resultado-gestion-${id}`);
        try {
          await fetchJSON(`/api/usuarios/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rol: select.value }),
          });
          destino.innerHTML = '<div class="mensaje exito">✅ Rol actualizado.</div>';
          // Actualiza solo la insignia de rol de la fila (sin recargar toda la
          // tabla) para que el mensaje de arriba no desaparezca de inmediato.
          const filaPrincipal = el(`gestionar-${id}`).previousElementSibling;
          const badgeRol = filaPrincipal.querySelector('td:nth-child(3) .badge');
          if (badgeRol) {
            badgeRol.className = `badge ${select.value}`;
            badgeRol.textContent = ROL_LABEL[select.value] || select.value;
          }
        } catch (e) {
          destino.innerHTML = `<div class="mensaje error">${e.message}</div>`;
        }
      });
    });

    el('lista-usuarios').querySelectorAll('[data-guardar-pass]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.guardarPass;
        const input = el('lista-usuarios').querySelector(`[data-pass-input="${id}"]`);
        const destino = el(`resultado-gestion-${id}`);
        if (!input.value || input.value.length < 6) {
          destino.innerHTML = '<div class="mensaje error">La contraseña debe tener al menos 6 caracteres.</div>';
          return;
        }
        try {
          await fetchJSON(`/api/usuarios/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ passwordNueva: input.value }),
          });
          destino.innerHTML = `<div class="mensaje exito">✅ Contraseña actualizada a: <strong>${input.value}</strong>. Compártesela a la persona.</div>`;
          input.value = '';
          // Ya no queda con contraseña temporal pendiente de cambiar — quita
          // esa nota si estaba, sin recargar toda la tabla.
          const filaPrincipal = el(`gestionar-${id}`).previousElementSibling;
          const notaTemporal = filaPrincipal.querySelector('td:nth-child(2) small');
          if (notaTemporal) notaTemporal.remove();
        } catch (e) {
          destino.innerHTML = `<div class="mensaje error">${e.message}</div>`;
        }
      });
    });

    el('lista-usuarios').querySelectorAll('[data-ver-pass]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.verPass;
        const inputAdmin = el('lista-usuarios').querySelector(`[data-ver-pass-admin="${id}"]`);
        const destino = el(`resultado-gestion-${id}`);
        if (!inputAdmin.value) {
          destino.innerHTML = '<div class="mensaje error">Escribe tu propia contraseña de admin para confirmar.</div>';
          return;
        }
        try {
          const r = await fetchJSON(`/api/usuarios/${id}/ver-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ passwordAdmin: inputAdmin.value }),
          });
          destino.innerHTML = `<div class="mensaje exito">🔑 Contraseña actual: <strong>${r.password}</strong></div>`;
          inputAdmin.value = '';
        } catch (e) {
          if (e.status === 423) {
            destino.innerHTML = `
              <div class="mensaje error">${e.message}</div>
              <div class="fila" style="grid-template-columns: 1fr 1fr; align-items:end; margin-top:6px">
                <div><label>Clave maestra de desbloqueo</label><input type="password" id="clave-maestra-${id}" placeholder="Solo la conoce quien instaló el sistema"></div>
                <div><button class="btn secundario pequeno" id="btn-desbloquear-${id}">Desbloquear</button></div>
              </div>`;
            el(`btn-desbloquear-${id}`).addEventListener('click', async () => {
              const claveMaestra = el(`clave-maestra-${id}`).value;
              try {
                await fetchJSON('/api/usuarios/desbloquear-ver-password', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ claveMaestra }),
                });
                destino.innerHTML = '<div class="mensaje exito">✅ Desbloqueado. Ya puedes intentar ver la contraseña de nuevo.</div>';
              } catch (e2) {
                destino.innerHTML = `<div class="mensaje error">${e2.message}</div>`;
              }
            });
          } else {
            destino.innerHTML = `<div class="mensaje error">${e.message}</div>`;
          }
        }
      });
    });
  }

  el('btn-crear-usuario').addEventListener('click', async () => {
    const nombre = el('u-nombre').value.trim();
    if (!nombre) {
      el('mensaje-usuario').innerHTML = '<div class="mensaje error">Ingresa el nombre completo.</div>';
      return;
    }
    const password = el('u-password').value;
    if (password && password.length < 6) {
      el('mensaje-usuario').innerHTML = '<div class="mensaje error">La contraseña debe tener al menos 6 caracteres (o déjala vacía para generar una automática).</div>';
      return;
    }
    el('btn-crear-usuario').disabled = true;
    try {
      const r = await fetchJSON('/api/usuarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre, rol: el('u-rol').value, password: password || undefined }),
      });
      el('u-nombre').value = '';
      el('u-password').value = '';
      el('mensaje-usuario').innerHTML = `<div class="mensaje exito">✅ Usuario creado — usuario: <strong>${r.usuario}</strong>, contraseña${password ? '' : ' temporal'}: <strong>${r.passwordTemporal}</strong>. Compártela con la persona.</div>`;
      await cargarUsuarios();
    } catch (e) {
      el('mensaje-usuario').innerHTML = `<div class="mensaje error">${e.message}</div>`;
    } finally {
      el('btn-crear-usuario').disabled = false;
    }
  });

  window.__sesion.then((usuario) => {
    if (!usuario) return;
    cargarNegocio();
    cargarUsuarios();
  });
})();
