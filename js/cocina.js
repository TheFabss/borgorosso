/* =========================================================
   BORGOROSSO · cocina.js
   Pantalla de cocina: comandas en vivo por estado.
   ========================================================= */
(function () {
  'use strict';

  const P = window.BorgoPedidos;
  const esc = P.esc;
  const MINUTOS_TARDE = 15;
  const ACCIONES = { nuevo: 'Empezar', preparando: 'Marcar listo', listo: 'Entregado' };

  const botonSonido = document.getElementById('coc-sonido');
  let audio = null;
  let conocidos = null;
  let pedidos = [];

  function campana() {
    if (!audio) return;
    const osc = audio.createOscillator();
    const vol = audio.createGain();
    osc.frequency.value = 880;
    vol.gain.setValueAtTime(0.3, audio.currentTime);
    vol.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.6);
    osc.connect(vol).connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + 0.6);
  }

  function tarjeta(p, nuevos) {
    const minutos = Math.floor((Date.now() - new Date(p.creado).getTime()) / 60000);
    const clases = ['coc-tarjeta', minutos >= MINUTOS_TARDE ? 'is-tarde' : '', nuevos.has(p.id) ? 'is-entrando' : ''].join(' ');
    const pagado = p.pago.estado === 'pagado';
    return `<article class="${clases}">
      <div class="coc-tarjeta__cabeza"><span class="coc-lugar">${esc(p.lugar)}</span><span class="coc-tiempo">${minutos} min</span></div>
      <ul>${p.items.map((i) => `<li><strong>${i.cantidad} ×</strong> ${esc(i.nombre)}${i.variante ? ` (${esc(i.variante)})` : ''}</li>`).join('')}</ul>
      ${p.notas ? `<p class="coc-notas">${esc(p.notas)}</p>` : ''}
      <div class="coc-pie">
        <span class="coc-sello${pagado ? ' is-pagado' : ''}">#${p.numero} · ${pagado ? 'Pagado' : 'Por cobrar'}</span>
        <span class="coc-acciones">${p.estado === 'nuevo' ? '' : `<button type="button" class="per-boton" data-retroceder="${p.id}">Atrás</button>`}<button type="button" class="per-boton per-boton--lleno" data-avanzar="${p.id}">${ACCIONES[p.estado]}</button></span>
      </div>
    </article>`;
  }

  function pintar() {
    const activos = pedidos.filter((p) => p.estado !== 'entregado');
    const nuevos = new Set(conocidos ? activos.filter((p) => !conocidos.has(p.id)).map((p) => p.id) : []);
    if (nuevos.size) campana();
    conocidos = new Set(pedidos.map((p) => p.id));

    ['nuevo', 'preparando', 'listo'].forEach((estado) => {
      const grupo = activos.filter((p) => p.estado === estado);
      document.getElementById(`n-${estado}`).textContent = grupo.length;
      document.getElementById(`col-${estado}`).innerHTML = grupo.length
        ? grupo.map((p) => tarjeta(p, nuevos)).join('')
        : '<p class="per-vacio">Sin comandas</p>';
    });
  }

  document.querySelector('.coc-columnas').addEventListener('click', (e) => {
    const atras = e.target.closest('[data-retroceder]');
    if (atras) P.retroceder(atras.dataset.retroceder).catch(() => window.alert('No se pudo guardar el cambio. Revisa la conexión.'));
    const boton = e.target.closest('[data-avanzar]');
    if (boton) P.avanzar(boton.dataset.avanzar).catch(() => window.alert('No se pudo guardar el cambio. Revisa la conexión.'));
  });

  /* El navegador exige un toque del personal antes de permitir sonido. */
  botonSonido.addEventListener('click', () => {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    audio.resume();
    campana();
    botonSonido.textContent = 'Sonido activo';
    botonSonido.classList.remove('per-boton--lleno');
    botonSonido.setAttribute('aria-pressed', 'true');
  });

  window.BorgoAcceso.entrar(() => P.suscribir((lista) => {
    pedidos = lista;
    pintar();
  }));
  setInterval(pintar, 30000);
})();
