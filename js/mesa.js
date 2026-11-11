/* =========================================================
   BORGOROSSO · mesa.js
   Pedido del cliente: QR de mesa (?mesa=5) o celular (sin
   parámetro), seguimiento en vivo y pago de la cuenta.
   ========================================================= */
(function () {
  'use strict';

  const P = window.BorgoPedidos;
  const { CATEGORIAS, CARTA } = window.BorgoCarta;
  const esc = P.esc;
  const CLAVE_MIOS = 'borgorosso_mesa_pedidos';
  const HORAS_CUENTA = 8;
  const NOMBRES_ESTADO = ['Confirmado', 'En cocina', 'Listo', 'Servido'];
  const PASOS = ['nuevo', 'preparando', 'listo', 'entregado'];
  const cobrable = (p) => p.pago.estado === 'pendiente' && p.estado !== 'por_confirmar' && p.estado !== 'rechazado';

  const mesa = (new URLSearchParams(location.search).get('mesa') || '').replace(/\D/g, '').slice(0, 3);
  /* La carta es una sola para todos: esta página solo muestra "Mi pedido y cuenta". */
  const aCarta = `carta.html${mesa ? `?mesa=${mesa}` : ''}`;
  if (new URLSearchParams(location.search).get('ver') !== 'pedido') {
    location.replace(aCarta);
    return;
  }
  const $ = (id) => document.getElementById(id);
  const form = $('form-pedido');
  const CLAVE_CESTA = `borgorosso_cesta_${mesa || 'celular'}`;
  let cesta = [];
  try {
    cesta = JSON.parse(sessionStorage.getItem(CLAVE_CESTA)) || [];
  } catch {
    cesta = [];
  }
  let recienEnviado = null;
  let enviando = false;
  let ultimoSeguimiento = '';
  let pedidos = [];
  let categoria = CATEGORIAS[0].id;

  const leerMios = () => {
    try {
      return JSON.parse(localStorage.getItem(CLAVE_MIOS)) || [];
    } catch {
      return [];
    }
  };

  $('cli-lugar').textContent = mesa ? `Mesa ${mesa}` : 'Pedido por celular';
  $('bloque-celular').hidden = Boolean(mesa);

  /* ---------- Carta ---------- */
  function pintarCarta() {
    $('cli-tabs').innerHTML = CATEGORIAS.map((c) =>
      `<button type="button" class="cli-tab" data-cat="${c.id}" aria-pressed="${c.id === categoria}">${esc(c.nombre)}</button>`
    ).join('');

    $('cli-platos').innerHTML = CARTA.filter((p) => p.cat === categoria).map((p) => {
      const botones = p.variantes
        ? p.variantes.map((v) => `<button type="button" class="cli-sumar" data-id="${p.id}" data-var="${esc(v.nombre)}">+ ${esc(v.nombre)} · S/ ${v.precio}</button>`).join('')
        : `<button type="button" class="cli-sumar" data-id="${p.id}">+ Agregar</button>`;
      return `<article class="cli-plato">
        <div class="cli-plato__fila"><h3>${esc(p.nombre)}</h3>${p.variantes ? '' : `<span class="cli-plato__precio">S/ ${p.precio}</span>`}</div>
        <p>${esc(p.desc)}</p>
        <div class="cli-plato__botones">${botones}</div>
      </article>`;
    }).join('');
  }

  function sumar(id, nombreVariante) {
    const plato = CARTA.find((p) => p.id === id);
    const variante = plato.variantes ? plato.variantes.find((v) => v.nombre === nombreVariante) : null;
    const key = `${id}|${nombreVariante}`;
    const linea = cesta.find((i) => i.key === key);
    if (linea) linea.cantidad += 1;
    else cesta.push({ key, id, nombre: plato.nombre, variante: nombreVariante, precio: variante ? variante.precio : plato.precio, cantidad: 1 });
    pintarCesta();
  }

  const totalCesta = () => cesta.reduce((s, i) => s + i.precio * i.cantidad, 0);

  function pintarCesta() {
    try {
      sessionStorage.setItem(CLAVE_CESTA, JSON.stringify(cesta));
    } catch {
      /* sin almacenamiento: la cesta dura mientras la página esté abierta */
    }
    const cantidad = cesta.reduce((s, i) => s + i.cantidad, 0);
    $('cli-ver').hidden = !cantidad;
    $('cli-ver-cantidad').textContent = `Ver pedido (${cantidad})`;
    $('cli-ver-total').textContent = `S/ ${totalCesta()}`;
    $('hoja-total').textContent = `S/ ${totalCesta()}`;
    $('hoja-lineas').innerHTML = cesta.map((i) => `
      <div class="cli-linea">
        <div>${esc(i.nombre)}${i.variante ? `<small>${esc(i.variante)}</small>` : ''}<small>S/ ${i.precio * i.cantidad}</small></div>
        <div class="cli-cantidad">
          <button type="button" data-key="${esc(i.key)}" data-delta="-1" aria-label="Quitar uno de ${esc(i.nombre)}">−</button>
          <span>${i.cantidad}</span>
          <button type="button" data-key="${esc(i.key)}" data-delta="1" aria-label="Añadir uno de ${esc(i.nombre)}">+</button>
        </div>
      </div>`).join('');
  }

  /* ---------- Seguimiento y cuenta ---------- */
  function misPedidos() {
    const limite = Date.now() - HORAS_CUENTA * 3600000;
    const ids = leerMios();
    /* Solo los pedidos de esta mesa: un mismo teléfono pudo pedir antes en otra. */
    return pedidos.filter((p) => ids.includes(p.token || p.id)
      && new Date(p.creado).getTime() > limite
      && (!mesa || p.lugar === `Mesa ${mesa}`));
  }

  function pintarSeguimiento() {
    const mios = misPedidos();
    const contenedor = $('vista-seguimiento');
    if (!mios.length) {
      const vacio = `<p class="cli-vacio">Aún no has enviado pedidos. Elige tus platos en la carta.</p><a class="cli-accion cli-pedir-mas" href="${aCarta}">Ver la carta</a>`;
      if (ultimoSeguimiento !== vacio) contenedor.innerHTML = vacio;
      ultimoSeguimiento = vacio;
      return;
    }
    const pendientes = mios.filter(cobrable);
    const esperando = mios.some((p) => p.estado === 'por_confirmar');
    const porPagar = pendientes.reduce((s, p) => s + p.total, 0);
    const pidioCaja = pendientes.length && pendientes.every((p) => p.pago.solicitaCaja);

    const tarjetas = mios.map((p) => {
      const actual = PASOS.indexOf(p.estado);
      const estado = p.estado === 'rechazado'
        ? '<p class="seg-estado seg-estado--rechazo">No pudimos confirmar tu mesa y el pedido fue cancelado. Llama a un mozo si sigues aquí.</p>'
        : p.estado === 'por_confirmar'
          ? '<p class="seg-estado">Esperando confirmación: un mozo verificará tu mesa en un momento.</p>'
          : `<ol class="seg-pasos">${NOMBRES_ESTADO.map((n, idx) => `<li class="${idx <= actual ? 'is-hecho' : ''}">${n}</li>`).join('')}</ol>`;
      return `<article class="seg-pedido${p.estado === 'rechazado' ? ' is-rechazado' : ''}">
        <div class="seg-pedido__cabeza"><span>Pedido #${p.numero}</span><span>S/ ${p.total}</span></div>
        <ul>${p.items.map((i) => `<li>${i.cantidad} × ${esc(i.nombre)}${i.variante ? ` (${esc(i.variante)})` : ''}</li>`).join('')}</ul>
        ${estado}
      </article>`;
    }).join('');

    let cuenta = esperando
      ? '<p>La cuenta se habilita cuando confirmemos tu pedido.</p>'
      : '<p><strong>Cuenta pagada.</strong> ¡Gracias por visitarnos!</p>';
    if (mios.every((p) => p.estado === 'rechazado')) cuenta = '<p>No tienes pedidos por pagar.</p>';
    if (pendientes.length) {
      cuenta = `<p class="cli-total"><span>Por pagar</span><span>S/ ${porPagar}</span></p>
        ${pidioCaja ? '<p>Avisamos a caja: puedes pagar al salir o te llevamos la cuenta.</p>' : ''}
        <button type="button" class="cli-accion" id="btn-pagar">Pagar en línea</button>
        ${pidioCaja ? '' : '<button type="button" class="cli-accion cli-accion--sec" id="btn-caja">Pagaré en caja</button>'}`;
    }
    const aviso = recienEnviado ? `<p class="seg-aviso">Tu pedido #${recienEnviado} llegó a cocina. Un mozo confirmará tu mesa en un momento.</p>` : '';
    /* Pedir más siempre está a la vista: volver a la carta con la misma mesa. */
    const pedirMas = `<a class="cli-accion cli-pedir-mas" href="${aCarta}">Pedir algo más</a>`;
    const html = `<h1>Mi pedido</h1>${aviso}${tarjetas}<section class="seg-cuenta">${cuenta}</section>${pedirMas}`;
    /* El sondeo no debe repintar ni reanunciar si nada cambió. */
    if (html !== ultimoSeguimiento) contenedor.innerHTML = html;
    ultimoSeguimiento = html;
  }

  function mostrarVista(vista) {
    const enCarta = vista === 'carta';
    if (enCarta) recienEnviado = null;
    $('vista-carta').hidden = !enCarta;
    $('vista-seguimiento').hidden = enCarta;
    $('nav-carta').toggleAttribute('aria-current', enCarta);
    $('nav-seguimiento').toggleAttribute('aria-current', !enCarta);
    if (enCarta) $('nav-carta').setAttribute('aria-current', 'page');
    else $('nav-seguimiento').setAttribute('aria-current', 'page');
    window.scrollTo(0, 0);
  }

  const idsPendientes = () => misPedidos().filter(cobrable).map((p) => p.token || p.id);

  const avisarFallo = () => window.alert('No pudimos registrar tu solicitud. Revisa tu conexión e inténtalo de nuevo.');

  /* ---------- Eventos ---------- */
  $('cli-tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('[data-cat]');
    if (!tab) return;
    categoria = tab.dataset.cat;
    pintarCarta();
  });
  $('cli-platos').addEventListener('click', (e) => {
    const boton = e.target.closest('[data-id]');
    if (boton) sumar(boton.dataset.id, boton.dataset.var || '');
  });
  $('hoja-lineas').addEventListener('click', (e) => {
    const boton = e.target.closest('[data-key]');
    if (!boton) return;
    const linea = cesta.find((i) => i.key === boton.dataset.key);
    linea.cantidad += Number(boton.dataset.delta);
    cesta = cesta.filter((i) => i.cantidad > 0);
    pintarCesta();
    if (!cesta.length) $('hoja-pedido').close();
  });
  $('cli-ver').addEventListener('click', () => $('hoja-pedido').showModal());
  $('nav-carta').addEventListener('click', () => { location.href = aCarta; });
  $('nav-seguimiento').addEventListener('click', () => mostrarVista('seguimiento'));
  document.querySelectorAll('[data-cerrar]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));

  form.elements.modo.addEventListener('change', () => {
    const recojo = form.elements.modo.value === 'recojo';
    $('campo-mesa').hidden = recojo;
    $('campo-nombre').hidden = !recojo;
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const error = $('pedido-error');
    let lugar = mesa ? `Mesa ${mesa}` : '';
    const cliente = form.elements.cliente.value.trim();
    if (!mesa) {
      if (form.elements.modo.value === 'recojo') {
        if (!cliente) { error.textContent = 'Escribe tu nombre para llamarte al recoger.'; return; }
        lugar = `Recojo · ${cliente}`;
      } else {
        const numero = form.elements.mesa.value.replace(/\D/g, '');
        if (!numero) { error.textContent = 'Indica tu número de mesa.'; return; }
        lugar = `Mesa ${numero}`;
      }
    }
    error.textContent = '';

    const items = cesta.map(({ id, nombre, variante, precio, cantidad }) => ({ id, nombre, variante, precio, cantidad }));
    const enviar = form.querySelector('[type="submit"]');
    if (enviando) return; // un doble toque no debe duplicar la comanda
    enviando = true;
    enviar.disabled = true;
    enviar.textContent = 'Enviando…';
    let pedido;
    try {
      pedido = await P.crear({ lugar, origen: mesa ? 'qr' : 'celular', cliente, items, notas: form.elements.notas.value.trim() });
    } catch {
      error.textContent = 'No pudimos enviar tu pedido. Revisa tu conexión e inténtalo de nuevo.';
      enviando = false;
    enviar.disabled = false;
      enviar.textContent = 'Enviar a cocina';
      return;
    }
    enviando = false;
    enviar.disabled = false;
    enviar.textContent = 'Enviar a cocina';
    recienEnviado = pedido.numero;
    localStorage.setItem(CLAVE_MIOS, JSON.stringify([...leerMios(), pedido.token || pedido.id].slice(-30)));
    await P.refrescar();
    cesta = [];
    form.elements.notas.value = '';
    pintarCesta();
    $('hoja-pedido').close();
    pintarSeguimiento();
    mostrarVista('seguimiento');
  });

  $('vista-seguimiento').addEventListener('click', (e) => {
    if (e.target.id === 'btn-caja') P.solicitarCaja(idsPendientes()).catch(avisarFallo);
    if (e.target.id === 'btn-pagar') {
      $('pago-total').textContent = `S/ ${misPedidos().filter(cobrable).reduce((s, p) => s + p.total, 0)}`;
      $('hoja-pago').showModal();
    }
  });
  $('pago-confirmar').addEventListener('click', () => {
    P.pagarEnLinea(idsPendientes()).catch(avisarFallo);
    $('hoja-pago').close();
  });

  pintarCarta();
  pintarCesta();
  mostrarVista('seguimiento');
  P.suscribirCliente((lista) => {
    pedidos = lista;
    pintarSeguimiento();
  });
})();
