/* =========================================================
   BORGOROSSO · caja.js
   Cuentas abiertas por mesa y cobro en caja.
   ========================================================= */
(function () {
  'use strict';

  const P = window.BorgoPedidos;
  const esc = P.esc;
  const METODOS = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', yape_plin: 'Yape / Plin', en_linea: 'En línea' };
  const esHoy = (iso) => new Date(iso).toDateString() === new Date().toDateString();

  function pintar(pedidos) {
    const pagados = pedidos.filter((p) => p.pago.estado === 'pagado' && esHoy(p.creado));
    const totales = Object.keys(METODOS).map((m) => [m, pagados.filter((p) => p.pago.metodo === m).reduce((s, p) => s + p.total, 0)]);
    document.getElementById('caj-resumen').innerHTML = [
      `<div>Cobrado hoy<strong>S/ ${pagados.reduce((s, p) => s + p.total, 0)}</strong></div>`,
      ...totales.map(([m, t]) => `<div>${METODOS[m]}<strong>S/ ${t}</strong></div>`)
    ].join('');

    const grupos = new Map();
    pedidos.filter((p) => p.pago.estado === 'pendiente' && p.estado !== 'por_confirmar' && p.estado !== 'rechazado').forEach((p) => {
      grupos.set(p.lugar, [...(grupos.get(p.lugar) || []), p]);
    });

    const cuentas = [...grupos.entries()].map(([lugar, lista]) => {
      const solicita = lista.some((p) => p.pago.solicitaCaja);
      const total = lista.reduce((s, p) => s + p.total, 0);
      const ids = lista.map((p) => p.id).join(',');
      const lineas = lista.flatMap((p) => p.items).map((i) =>
        `<li>${i.cantidad} × ${esc(i.nombre)}${i.variante ? ` (${esc(i.variante)})` : ''} — S/ ${i.precio * i.cantidad}</li>`
      ).join('');
      return `<article class="caj-cuenta${solicita ? ' is-solicita' : ''}">
        <div class="caj-cuenta__cabeza"><h2>${esc(lugar)}</h2><span class="caj-total">S/ ${total}</span></div>
        ${solicita ? '<p class="caj-aviso">Pagará en caja</p>' : ''}
        <ul>${lineas}</ul>
        <div class="caj-metodos">
          <button type="button" class="per-boton" data-cobrar="${ids}" data-metodo="efectivo">Cobrar S/ ${total} · Efectivo</button>
          <button type="button" class="per-boton" data-cobrar="${ids}" data-metodo="tarjeta">Cobrar S/ ${total} · Tarjeta</button>
          <button type="button" class="per-boton" data-cobrar="${ids}" data-metodo="yape_plin">Cobrar S/ ${total} · Yape / Plin</button>
        </div>
      </article>`;
    }).join('');

    document.getElementById('caj-cuentas').innerHTML = cuentas || '<p class="per-vacio">No hay cuentas abiertas</p>';
  }

  document.getElementById('caj-cuentas').addEventListener('click', (e) => {
    const boton = e.target.closest('[data-cobrar]');
    if (!boton) return;
    /* Cerrar una cuenta exige un segundo toque: evita cobros por error. */
    if (!boton.dataset.armado) {
      const original = boton.textContent;
      boton.dataset.armado = '1';
      boton.textContent = '¿Confirmar cobro? Toca otra vez';
      boton.classList.add('per-boton--lleno');
      setTimeout(() => {
        boton.textContent = original;
        boton.classList.remove('per-boton--lleno');
        delete boton.dataset.armado;
      }, 4000);
      return;
    }
    P.pagar(boton.dataset.cobrar.split(','), boton.dataset.metodo).catch(() => window.alert('No se pudo registrar el cobro. Revisa la conexión.'));
  });

  window.BorgoAcceso.entrar(() => P.suscribir(pintar));
})();
