(function () {
  const el = (id) => document.getElementById(id);

  async function intentarLogin() {
    const usuario = el('usuario').value.trim();
    const password = el('password').value;
    if (!usuario || !password) {
      el('mensaje').innerHTML = '<div class="mensaje error">Ingresa tu usuario y contraseña.</div>';
      return;
    }
    el('btn-login').disabled = true;
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario, password }),
    });
    el('btn-login').disabled = false;
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      el('mensaje').innerHTML = `<div class="mensaje error">${data.error || 'No se pudo iniciar sesión.'}</div>`;
      return;
    }
    location.href = '/index.html';
  }

  el('btn-login').addEventListener('click', intentarLogin);
  el('password').addEventListener('keydown', (e) => { if (e.key === 'Enter') intentarLogin(); });
  el('usuario').addEventListener('keydown', (e) => { if (e.key === 'Enter') el('password').focus(); });
})();
