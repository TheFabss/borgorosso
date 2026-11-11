/* =========================================================
   BORGOROSSO · acceso-personal.js
   Login de cocina y caja. En modo demostración no pide nada.
   ========================================================= */
(function () {
  'use strict';

  const P = window.BorgoPedidos;

  async function esPersonal() {
    const { data, error } = await P.db.rpc('es_personal');
    return !error && data === true;
  }

  function mensajeDeFallo(fallo) {
    if (fallo.code === 'email_not_confirmed') return 'Este correo aún no está confirmado en Supabase.';
    if (fallo.code === 'invalid_credentials') return 'Correo o contraseña incorrectos.';
    if (fallo.status === 429) return 'Demasiados intentos. Espera unos minutos y vuelve a probar.';
    return 'No se pudo conectar con el sistema. Revisa la conexión e inténtalo de nuevo.';
  }

  function agregarSalir() {
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'per-boton';
    boton.textContent = 'Cerrar sesión';
    boton.addEventListener('click', async () => {
      await P.db.auth.signOut();
      location.reload();
    });
    document.querySelector('.per-cabecera').appendChild(boton);
  }

  function pedirLogin(alEntrar) {
    const capa = document.createElement('div');
    capa.className = 'per-login';
    capa.innerHTML = `
      <form class="per-login__caja">
        <span class="op-marca">BORGOROSSO</span>
        <h2>Acceso del personal</h2>
        <label>Correo <input name="email" type="email" autocomplete="username" required></label>
        <label>Contraseña <input name="clave" type="password" autocomplete="current-password" required></label>
        <p class="per-login__error" role="alert"></p>
        <button type="submit" class="per-boton per-boton--lleno">Entrar</button>
      </form>`;
    document.body.appendChild(capa);
    const form = capa.querySelector('form');
    const error = capa.querySelector('.per-login__error');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      error.textContent = '';
      const { error: fallo } = await P.db.auth.signInWithPassword({
        email: form.elements.email.value.trim(),
        password: form.elements.clave.value
      });
      if (fallo) {
        error.textContent = mensajeDeFallo(fallo);
        return;
      }
      if (!(await esPersonal())) {
        await P.db.auth.signOut();
        error.textContent = 'Esta cuenta no está autorizada.';
        return;
      }
      capa.remove();
      agregarSalir();
      alEntrar();
    });
  }

  async function entrar(alEntrar) {
    if (!P.remoto) {
      alEntrar();
      return;
    }
    const { data } = await P.db.auth.getSession();
    if (data.session && await esPersonal()) {
      agregarSalir();
      alEntrar();
    } else {
      pedirLogin(alEntrar);
    }
  }

  window.BorgoAcceso = { entrar };
})();
