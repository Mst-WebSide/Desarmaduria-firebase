(function () {
  const el = (id) => document.getElementById(id);

  el('btn-cambiar').addEventListener('click', async () => {
    const actual = el('password-actual').value;
    const nueva = el('password-nueva').value;
    const confirmar = el('password-confirmar').value;
    if (!actual || !nueva || !confirmar) {
      el('mensaje').innerHTML = '<div class="mensaje error">Completa los tres campos.</div>';
      return;
    }
    if (nueva !== confirmar) {
      el('mensaje').innerHTML = '<div class="mensaje error">La confirmación no coincide con la contraseña nueva.</div>';
      return;
    }
    el('btn-cambiar').disabled = true;
    try {
      await fetchJSON('/api/auth/cambiar-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passwordActual: actual, passwordNueva: nueva }),
      });
      el('mensaje').innerHTML = '<div class="mensaje exito">✅ Contraseña actualizada.</div>';
      setTimeout(() => { location.href = '/index.html'; }, 1200);
    } catch (e) {
      el('mensaje').innerHTML = `<div class="mensaje error">${e.message}</div>`;
    } finally {
      el('btn-cambiar').disabled = false;
    }
  });
})();
