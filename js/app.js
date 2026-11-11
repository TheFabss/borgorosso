/* =========================================================
   BORGOROSSO · app.js
   Carta, carrito, geolocalización, fidelización de clientes,
   reservas y mensajes de WhatsApp.
   Expone window.Borgorosso para chatbot.js.
   ========================================================= */
(function () {
  'use strict';

  /* ---------- Datos del negocio ---------- */
  const NEGOCIO = {
    nombre: 'Borgorosso',
    whatsapp: '51973548429',
    direccion: 'Jr. Cuzco 166-366, Lurigancho-Chosica 15468',
    apertura: '08:30',
    cierre: '23:00',
    deliveryDesde: '12:00',
    anticipacionReservaMin: 15,
    zonaHoraria: 'America/Lima'
  };

  /* Campaña vigente hasta "fecha". "inicio" es el destino de la cuenta regresiva (hora editable). */
  const EVENTO = {
    fecha: '2026-12-31',
    inicio: '2026-12-24T20:00:00-05:00',
    nombre: 'Navidad en Borgorosso'
  };

  const MOTIVOS = {
    navidad: 'Temporada de Navidad',
    regular: 'Reserva Regular'
  };

  const ZONAS = [
    { id: 'salon', icono: '🖼️', nombre: 'Salón', desc: 'Interior vintage con arte y pinturas' },
    { id: 'terraza', icono: '🌿', nombre: 'Terraza', desc: 'Al aire libre, floral y vintage' }
  ];

  const CLAVES = {
    clientes: 'borgorosso_clientes',
    activo: 'borgorosso_cliente_activo',
    carrito: 'borgorosso_carrito'
  };

  /* ---------- Almacenamiento seguro (modo privado o bloqueado) ---------- */
  const almacen = {
    leer(clave, respaldo) {
      try {
        const valor = localStorage.getItem(clave);
        return valor === null ? respaldo : JSON.parse(valor);
      } catch {
        return respaldo;
      }
    },
    guardar(clave, valor) {
      try {
        localStorage.setItem(clave, JSON.stringify(valor));
      } catch {
        /* Sin almacenamiento: la web sigue funcionando, solo sin memoria. */
      }
    },
    borrar(clave) {
      try {
        localStorage.removeItem(clave);
      } catch {
        /* ignorar */
      }
    }
  };

  /* ---------- Carta (precios en soles) ---------- */
  const { CATEGORIAS, CARTA } = window.BorgoCarta;

  const CATALOGO = new Map(CARTA.map((p) => [p.id, p]));

  /* ---------- Utilidades de texto, hora y fecha ---------- */
  const normalizar = (texto) => String(texto)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

  const escapar = (texto) => String(texto).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));

  const pad = (n) => String(n).padStart(2, '0');
  const aMinutos = (hhmm) => {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
  };
  const formatearFecha = (iso) => {
    const [anio, mes, dia] = iso.split('-');
    return `${dia}/${mes}/${anio}`;
  };

  /* Hora y fecha de Lima, sin importar la zona horaria del dispositivo. */
  function ahoraLima() {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: NEGOCIO.zonaHoraria,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    });
    const partes = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
    return {
      fecha: `${partes.year}-${partes.month}-${partes.day}`,
      hora: `${partes.hour}:${partes.minute}`
    };
  }

  const dentroDeHorario = (hhmm) =>
    Boolean(hhmm) && aMinutos(hhmm) >= aMinutos(NEGOCIO.apertura) && aMinutos(hhmm) <= aMinutos(NEGOCIO.cierre);
  const deliveryDisponible = () => aMinutos(ahoraLima().hora) >= aMinutos(NEGOCIO.deliveryDesde);
  const eventoVigente = () => ahoraLima().fecha <= EVENTO.fecha;
  /* Una reserva en diciembre, mientras dure la campaña, es de Temporada de Navidad. */
  const esTemporadaNavidad = (fecha) => Boolean(fecha) && eventoVigente() && fecha.slice(5, 7) === '12' && fecha <= EVENTO.fecha;

  /* ---------- Carrito ---------- */
  const getCarrito = () => almacen.leer(CLAVES.carrito, []);

  function guardarCarrito(items) {
    almacen.guardar(CLAVES.carrito, items);
    window.dispatchEvent(new CustomEvent('carrito:cambio', { detail: items }));
  }

  function agregarAlCarrito(id, nombreVariante = '') {
    const producto = CATALOGO.get(id);
    if (!producto) return null;
    const variante = producto.variantes
      ? producto.variantes.find((v) => v.nombre === nombreVariante)
      : null;
    if (producto.variantes && !variante) return null;

    const precio = variante ? variante.precio : producto.precio;
    const nombreVar = variante ? variante.nombre : '';
    const key = `${id}|${nombreVar}`;
    const items = getCarrito();
    const existente = items.find((i) => i.key === key);
    if (existente) existente.cantidad += 1;
    else items.push({ key, id, nombre: producto.nombre, variante: nombreVar, precio, cantidad: 1 });

    guardarCarrito(items);
    return items;
  }

  function cambiarCantidad(key, delta) {
    const items = getCarrito()
      .map((i) => (i.key === key ? { ...i, cantidad: i.cantidad + delta } : i))
      .filter((i) => i.cantidad > 0);
    guardarCarrito(items);
  }

  const totalCarrito = (items) => items.reduce((suma, i) => suma + i.precio * i.cantidad, 0);
  const cantidadCarrito = (items) => items.reduce((suma, i) => suma + i.cantidad, 0);
  const lineasCarrito = (items) => items.map((i) =>
    `${i.cantidad} x ${i.nombre}${i.variante ? ` (${i.variante})` : ''} — S/ ${i.precio * i.cantidad}`
  );

  /* ---------- Geolocalización ---------- */
  function mensajeErrorGeo(error) {
    if (error.code === 1) return 'Permiso de ubicación denegado.';
    if (error.code === 2) return 'No pudimos detectar tu ubicación.';
    return 'La ubicación tardó demasiado.';
  }

  /* Requiere contexto seguro: http://localhost o https. */
  function obtenerUbicacion() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Tu navegador no permite obtener la ubicación.'));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = pos.coords.latitude.toFixed(6);
          const lng = pos.coords.longitude.toFixed(6);
          resolve({ lat, lng, url: `https://www.google.com/maps?q=${lat},${lng}` });
        },
        (error) => reject(new Error(mensajeErrorGeo(error))),
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
      );
    });
  }

  /* ---------- Fidelización de clientes ---------- */
  const claveCliente = (nombre) => normalizar(nombre).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const getClientes = () => almacen.leer(CLAVES.clientes, {});

  function getClienteActivo() {
    const clave = almacen.leer(CLAVES.activo, null);
    return clave ? getClientes()[clave] || null : null;
  }

  function identificarCliente(nombre) {
    const limpio = nombre.trim().replace(/\s+/g, ' ');
    const clave = claveCliente(limpio);
    if (!clave) return null;

    const clientes = getClientes();
    const nuevo = !clientes[clave];
    if (nuevo) {
      clientes[clave] = { nombre: limpio, creado: new Date().toISOString(), visitas: 0, pedidos: [], reservas: [] };
    }
    clientes[clave].visitas += 1;
    clientes[clave].ultimaVisita = new Date().toISOString();
    almacen.guardar(CLAVES.clientes, clientes);
    almacen.guardar(CLAVES.activo, clave);
    return { cliente: clientes[clave], nuevo };
  }

  const cerrarSesionCliente = () => almacen.borrar(CLAVES.activo);

  function guardarEnHistorial(tipo, datos) {
    const clave = almacen.leer(CLAVES.activo, null);
    const clientes = getClientes();
    if (!clave || !clientes[clave]) return;
    const lista = tipo === 'reserva' ? clientes[clave].reservas : clientes[clave].pedidos;
    lista.push({ ...datos, registrado: new Date().toISOString() });
    almacen.guardar(CLAVES.clientes, clientes);
  }

  /* ---------- Envío a cocina (misma vía que el QR de mesa) ---------- */
  const CLAVE_MIS_PEDIDOS = 'borgorosso_mesa_pedidos';
  const LIMITE_NOTAS = 160;

  /* El servidor solo admite "Mesa N" con 1 a 3 dígitos. */
  function numeroMesa(texto) {
    const m = String(texto).trim().match(/^(?:mesa\s*)?(\d{1,3})$/i);
    return m ? m[1] : '';
  }

  /* La mesa sale solo del enlace del QR (carta.html?mesa=N). Quien entra a la carta
     desde la web está en modo delivery, aunque antes haya escaneado una mesa. */
  const CLAVE_MESA = 'borgorosso_mesa'; // versiones anteriores la guardaban; se limpia al cargar
  almacen.borrar(CLAVE_MESA);
  const mesaActual = () => numeroMesa(new URLSearchParams(location.search).get('mesa') || '');

  const olvidarMesa = () => almacen.borrar(CLAVE_MESA);

  async function enviarACocina({ mesa, cliente, items, notas = '' }) {
    const numero = numeroMesa(mesa);
    const pedido = await window.BorgoPedidos.crear({
      lugar: `Mesa ${numero}`,
      origen: numero === mesaActual() ? 'qr' : 'celular',
      cliente: cliente.slice(0, 50),
      items: items.map(({ id, nombre, variante, precio, cantidad }) => ({ id, nombre, variante, precio, cantidad })),
      notas: notas.slice(0, LIMITE_NOTAS)
    });
    /* Con este token, mesa.html muestra el avance y la cuenta del pedido. */
    almacen.guardar(CLAVE_MIS_PEDIDOS, [...almacen.leer(CLAVE_MIS_PEDIDOS, []), pedido.token || pedido.id].slice(-30));
    return { pedido, seguimiento: `mesa.html?mesa=${numero}&ver=pedido` };
  }

  /* ---------- Mensajes de WhatsApp ---------- */
  const waLink = (texto) => `https://wa.me/${NEGOCIO.whatsapp}?text=${encodeURIComponent(texto)}`;

  function textoPedido({ nombre, modalidad, mesa, ubicacion, detalle, total, notas, ticket }) {
    const lineas = [
      `¡Hola Borgorosso! Soy ${nombre} (Cliente Web). Deseo confirmar un PEDIDO:`,
      `• Modalidad: ${modalidad}`
    ];
    if (mesa) lineas.push(`• Mesa / Reserva: ${mesa}`);
    if (ubicacion) lineas.push(`• Ubicación: ${ubicacion}`);
    lineas.push('• Detalle:');
    detalle.forEach((linea) => lineas.push(`   - ${linea}`));
    lineas.push(`• Total: ${total != null ? `S/ ${total}` : 'por confirmar'}`);
    if (notas) lineas.push(`• Notas: ${notas}`);
    if (ticket) lineas.push(`• Ticket: ${ticket}`);
    return lineas.join('\n');
  }

  function textoBanquete({ nombre, ocasion, fecha, hora, personas, zona, plato }) {
    const lineas = [
      `¡Hola Borgorosso! Soy ${nombre} (Cliente Web). Deseo solicitar una COTIZACIÓN DE BANQUETE:`,
      `• Ocasión: ${ocasion}`,
      `• Fecha y Hora: ${formatearFecha(fecha)} · ${hora}`,
      `• N° de Invitados: ${personas} personas`
    ];
    if (zona) lineas.push(`• Ambiente: ${zona}`);
    if (plato) lineas.push(`• Plato o menú deseado: ${plato}`);
    lineas.push('¡Quedo atento a la cotización!');
    return lineas.join('\n');
  }

  function textoReserva({ nombre, motivo, fecha, hora, personas, zona, notas = '' }) {
    const lineas = [
      `¡Hola Borgorosso! Soy ${nombre} (Cliente Web). Deseo confirmar una RESERVA DE MESA:`,
      `• Motivo: ${motivo}`,
      `• Fecha y Hora: ${formatearFecha(fecha)} · ${hora}`,
      `• N° de Personas: ${personas} personas`
    ];
    if (zona) lineas.push(`• Zona preferida: ${zona}`);
    if (notas) lineas.push(`• Notas: ${notas}`);
    lineas.push('¡Quedo atento a la confirmación!');
    return lineas.join('\n');
  }

  /* ---------- Interfaz compartida: toasts, modales, carrito ---------- */
  function toast(mensaje) {
    let zona = document.querySelector('.toast-zona');
    if (!zona) {
      zona = document.createElement('div');
      zona.className = 'toast-zona';
      zona.setAttribute('aria-live', 'polite');
      document.body.appendChild(zona);
    }
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = mensaje;
    zona.appendChild(el);
    setTimeout(() => el.classList.add('is-saliendo'), 2200);
    setTimeout(() => el.remove(), 2600);
  }

  /* Safari en iPhone ignora overflow:hidden: se fija la página en su sitio y se devuelve al cerrar. */
  let scrollGuardado = 0;
  function bloquearScroll() {
    const hayAbiertos = Boolean(document.querySelector('.modal.is-open, .drawer.is-open'));
    const estabaBloqueado = document.body.classList.contains('bloqueado');
    if (hayAbiertos && !estabaBloqueado) {
      scrollGuardado = window.scrollY;
      document.body.style.top = `-${scrollGuardado}px`;
    }
    document.body.classList.toggle('bloqueado', hayAbiertos);
    if (!hayAbiertos && estabaBloqueado) {
      document.body.style.top = '';
      window.scrollTo({ top: scrollGuardado, behavior: 'instant' });
    }
  }

  function abrirModal(el) {
    el.classList.add('is-open');
    bloquearScroll();
    el.querySelector('input, select, button')?.focus();
  }

  function cerrarModal(el) {
    el.classList.remove('is-open');
    bloquearScroll();
  }

  function abrirCarrito() {
    const campoNombre = document.querySelector('#pedido-form [name="nombre"]');
    const activo = getClienteActivo();
    if (campoNombre && !campoNombre.value && activo) campoNombre.value = activo.nombre;
    document.getElementById('carrito-drawer')?.classList.add('is-open');
    document.getElementById('drawer-overlay')?.classList.add('is-open');
    bloquearScroll();
  }

  function cerrarCarrito() {
    document.getElementById('carrito-drawer')?.classList.remove('is-open');
    document.getElementById('drawer-overlay')?.classList.remove('is-open');
    bloquearScroll();
  }

  /* ---------- Concierge de Experiencias: modal de reservas (todas las páginas) ---------- */
  const HORAS_EVENTO = [['19:00', '7:00 PM'], ['20:00', '8:00 PM'], ['21:00', '9:00 PM']];

  const ICONOS = {
    calendario: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M3.5 10h17M8 3v4M16 3v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    reloj: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M12 7.5V12l3 2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    persona: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8.5" r="3.8" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M4.5 20c1.2-4 4-6 7.5-6s6.3 2 7.5 6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>'
  };

  function montarModalReserva() {
    if (document.getElementById('modal-reserva')) return;

    const zonas = ZONAS.map((z) => `
      <label class="tarjeta-opcion tarjeta-opcion--zona">
        <input type="radio" name="zona" value="${z.id}">
        <span class="tarjeta-opcion__icono" aria-hidden="true">${z.icono}</span>
        <span class="tarjeta-opcion__txt"><strong>${escapar(z.nombre)}</strong><small>${escapar(z.desc)}</small></span>
      </label>`).join('');
    const personas = [2, 4, 6, 8].map((n) =>
      `<button type="button" class="chip-personas" data-personas="${n}" aria-pressed="false">${n === 8 ? '8+' : n}</button>`
    ).join('');
    const horas = HORAS_EVENTO.map(([valor, texto]) =>
      `<button type="button" class="pildora" data-hora="${valor}" aria-pressed="false">${texto}</button>`
    ).join('');

    document.body.insertAdjacentHTML('beforeend', `
      <div class="modal" id="modal-reserva" role="dialog" aria-modal="true" aria-labelledby="reserva-titulo">
        <div class="modal__panel concierge textura">
          <button type="button" class="modal__cerrar" data-cerrar-modal aria-label="Cerrar">✕</button>

          <div id="reserva-vista-form">
            <p class="eyebrow concierge__eyebrow">Concierge de Experiencias · Borgorosso</p>
            <h2 id="reserva-titulo" class="titulo modal__titulo">Reserva tu Mesa</h2>
            <p class="concierge__intro">Cuéntanos cómo imaginas tu visita y preparamos la casona para ti.</p>

            <form id="reserva-form" novalidate>
              <fieldset class="concierge__paso">
                <legend><span class="paso-num">1</span>¿Qué experiencia buscas?</legend>
                <div class="tarjetas-tipo">
                  <label class="tarjeta-opcion">
                    <input type="radio" name="tipo" value="regular" checked>
                    <span class="tarjeta-opcion__icono" aria-hidden="true">🍷</span>
                    <span class="tarjeta-opcion__txt"><strong>Reserva de mesa</strong><small>Almuerzo, cena o celebración. En diciembre, con la casona vestida de Navidad.</small></span>
                  </label>
                  <label class="tarjeta-opcion">
                    <input type="radio" name="tipo" value="banquete">
                    <span class="tarjeta-opcion__icono" aria-hidden="true">🥂</span>
                    <span class="tarjeta-opcion__txt"><strong>Cotizar Banquete</strong><small>Menú personalizado para reuniones y celebraciones</small></span>
                  </label>
                </div>
              </fieldset>

              <fieldset class="concierge__paso">
                <legend><span class="paso-num">2</span>¿Cuándo nos visitas?</legend>
                <div class="grid-2">
                  <label class="campo-editorial" data-campo-fecha>
                    <span>Fecha</span>
                    <span class="campo-editorial__control">${ICONOS.calendario}<input name="fecha" type="date" required></span>
                  </label>
                  <label class="campo-editorial">
                    <span>Hora de llegada</span>
                    <span class="campo-editorial__control">${ICONOS.reloj}<input name="hora" type="time" min="08:30" max="23:00" step="900" required></span>
                  </label>
                </div>
                <div class="horas-sugeridas" data-horas-evento hidden>
                  <span>Horarios sugeridos para la noche:</span>${horas}
                </div>
                <p class="nota concierge__nota">Atendemos todos los días de 8:30 AM a 11:00 PM. Puedes reservar hasta 15 minutos antes de tu llegada.</p>
              </fieldset>

              <fieldset class="concierge__paso">
                <legend><span class="paso-num">3</span>¿Cuántos serán?</legend>
                <div class="fila-personas" data-bloque-personas>${personas}</div>
                <input type="hidden" name="personas" value="">
                <div data-bloque-banquete hidden>
                  <div class="grid-2">
                    <label class="campo-editorial">
                      <span>N° de invitados</span>
                      <span class="campo-editorial__control">${ICONOS.persona}<input name="invitados" type="number" min="2" max="300" inputmode="numeric"></span>
                    </label>
                    <label class="campo-editorial">
                      <span>Ocasión</span>
                      <span class="campo-editorial__control"><input name="ocasion" type="text" maxlength="60" placeholder="Reunión, cumpleaños, boda…"></span>
                    </label>
                  </div>
                  <label class="campo-editorial concierge__plato">
                    <span>Plato o menú que imaginas</span>
                    <span class="campo-editorial__control"><textarea name="plato" rows="2" maxlength="300" placeholder="Ej. Lomo saltado para todos, con postre y bebida"></textarea></span>
                  </label>
                </div>
              </fieldset>

              <fieldset class="concierge__paso">
                <legend><span class="paso-num">4</span>Elige tu ambiente</legend>
                <div class="tarjetas-zona">${zonas}</div>
              </fieldset>

              <fieldset class="concierge__paso">
                <legend><span class="paso-num">5</span>Tus datos</legend>
                <label class="campo-editorial">
                  <span>Nombre completo</span>
                  <span class="campo-editorial__control">${ICONOS.persona}<input name="nombre" type="text" autocomplete="name" maxlength="60" required></span>
                </label>
              </fieldset>

              <p class="error" id="reserva-error" role="alert"></p>
              <button class="btn-vino w-full concierge__enviar" type="submit">Confirmar y enviar por WhatsApp</button>
            </form>
          </div>

          <div id="reserva-vista-ok" class="concierge__ok" hidden>
            <span class="concierge__sello" aria-hidden="true">✓</span>
            <p class="eyebrow">Solicitud registrada</p>
            <h2 class="titulo modal__titulo">¡Gracias por elegirnos!</h2>
            <p class="texto-suave">Tu reserva quedó guardada en tu historial. Envíala ahora a nuestro WhatsApp para confirmarla.</p>
            <a class="btn-vino w-full" id="reserva-wa" href="#" target="_blank" rel="noopener">📲 Confirmar por WhatsApp</a>
          </div>
        </div>
      </div>`);

    const form = document.getElementById('reserva-form');
    form.addEventListener('submit', enviarReserva);
    form.addEventListener('change', (e) => { if (e.target.name === 'tipo' || e.target.name === 'fecha') ajustarTipoReserva(); });
    form.elements.fecha.addEventListener('input', () => ajustarTipoReserva());
    form.elements.hora.addEventListener('input', marcarHoraSugerida);

    form.querySelectorAll('[data-hora]').forEach((boton) =>
      boton.addEventListener('click', () => {
        form.elements.hora.value = boton.dataset.hora;
        marcarHoraSugerida();
      })
    );
    form.querySelectorAll('[data-personas]').forEach((boton) =>
      boton.addEventListener('click', () => {
        form.elements.personas.value = boton.dataset.personas;
        form.querySelectorAll('[data-personas]').forEach((b) =>
          b.setAttribute('aria-pressed', String(b === boton))
        );
      })
    );
  }

  function marcarHoraSugerida() {
    const form = document.getElementById('reserva-form');
    form.querySelectorAll('[data-hora]').forEach((b) =>
      b.setAttribute('aria-pressed', String(b.dataset.hora === form.elements.hora.value))
    );
  }

  /* En diciembre la reserva pasa a ser de Navidad y sugiere horarios de noche. */
  function ajustarTipoReserva() {
    const form = document.getElementById('reserva-form');
    const esBanquete = form.elements.tipo.value === 'banquete';
    const fecha = form.elements.fecha;

    fecha.min = ahoraLima().fecha;

    form.querySelector('[data-horas-evento]').hidden = esBanquete || !esTemporadaNavidad(fecha.value);
    form.querySelector('[data-bloque-personas]').hidden = esBanquete;
    form.querySelector('[data-bloque-banquete]').hidden = !esBanquete;
    form.querySelector('[type="submit"]').textContent = esBanquete
      ? 'Solicitar cotización por WhatsApp'
      : 'Confirmar y enviar por WhatsApp';
    if (!form.elements.zona.value) form.elements.zona.value = 'salon';
    marcarHoraSugerida();
  }

  function abrirReserva({ tipo = 'regular' } = {}) {
    montarModalReserva();
    const modal = document.getElementById('modal-reserva');
    const form = document.getElementById('reserva-form');
    form.reset();
    document.getElementById('reserva-vista-form').hidden = false;
    document.getElementById('reserva-vista-ok').hidden = true;
    document.getElementById('reserva-error').textContent = '';
    form.querySelectorAll('[data-personas]').forEach((b) => b.setAttribute('aria-pressed', 'false'));

    form.elements.tipo.value = tipo === 'banquete' ? 'banquete' : 'regular';
    /* Desde los botones de Navidad la fecha propuesta ya cae en diciembre. */
    if (tipo === 'navidad' && eventoVigente()) {
      const hoy = ahoraLima().fecha;
      const diciembre = `${hoy.slice(0, 4)}-12-01`;
      form.elements.fecha.value = hoy > diciembre ? hoy : diciembre;
    }

    const activo = getClienteActivo();
    if (activo) form.elements.nombre.value = activo.nombre;
    ajustarTipoReserva();


    abrirModal(modal);
  }

  function validarReserva({ nombre, fecha, hora, personas, zona }) {
    const ahora = ahoraLima();
    if (!claveCliente(nombre)) return 'Escribe tu nombre para registrar la reserva.';
    if (!fecha) return 'Selecciona la fecha de tu visita.';
    if (fecha < ahora.fecha) return 'La fecha elegida ya pasó.';
    if (!dentroDeHorario(hora)) return 'Elige una hora entre 8:30 AM y 11:00 PM.';
    if (fecha === ahora.fecha && aMinutos(hora) < aMinutos(ahora.hora) + NEGOCIO.anticipacionReservaMin) {
      return 'Las reservas se realizan con al menos 15 minutos de anticipación.';
    }
    if (!personas) return 'Indica cuántas personas serán.';
    if (!zona) return 'Elige el ambiente que prefieres.';
    return '';
  }

  function enviarReserva(evento) {
    evento.preventDefault();
    const form = evento.currentTarget;
    const error = document.getElementById('reserva-error');
    const nombre = form.elements.nombre.value.trim().replace(/\s+/g, ' ');
    const esBanquete = form.elements.tipo.value === 'banquete';
    const fecha = form.elements.fecha.value;
    const hora = form.elements.hora.value;
    const personas = Number(esBanquete ? form.elements.invitados.value : form.elements.personas.value);
    const zona = ZONAS.find((z) => z.id === form.elements.zona.value);

    const problema = validarReserva({ nombre, fecha, hora, personas, zona });
    if (problema) {
      error.textContent = problema;
      return;
    }
    error.textContent = '';

    const { cliente } = identificarCliente(nombre);
    let url;
    if (esBanquete) {
      const ocasion = form.elements.ocasion.value.trim() || 'Celebración';
      const plato = form.elements.plato.value.trim();
      guardarEnHistorial('reserva', { motivo: `Banquete (${ocasion})`, fecha, hora, personas, zona: zona.nombre, plato });
      url = waLink(textoBanquete({ nombre: cliente.nombre, ocasion, fecha, hora, personas, zona: zona.nombre, plato }));
    } else {
      const datos = {
        motivo: esTemporadaNavidad(fecha) ? MOTIVOS.navidad : MOTIVOS.regular,
        fecha,
        hora,
        personas,
        zona: zona.nombre
      };
      guardarEnHistorial('reserva', datos);
      url = waLink(textoReserva({ nombre: cliente.nombre, ...datos }));
    }
    window.open(url, '_blank', 'noopener');

    document.getElementById('reserva-wa').href = url;
    document.getElementById('reserva-vista-form').hidden = true;
    document.getElementById('reserva-vista-ok').hidden = false;
  }

  /* ---------- Tema: Casona Clásica / Navidad ---------- */
  const CLAVE_TEMA = 'borgorosso_tema';

  function aplicarTema(tema) {
    const noche = tema === 'navidad';
    document.body.dataset.theme = noche ? 'navidad' : 'casona';
    document.querySelectorAll('[data-tema-switch]').forEach((s) => {
      s.setAttribute('aria-checked', String(noche));
      s.setAttribute('aria-label', noche ? 'Cambiar a tema Casona Clásica' : 'Cambiar a tema Navidad');
    });
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', noche ? '#121016' : '#6E1414');
    ordenarCampana(noche);
  }

  /* En Navidad la campaña sube justo después de la portada; en la casona vuelve a su lugar. */
  let marcadorCampana = null;
  function ordenarCampana(noche) {
    const evento = document.getElementById('evento');
    const hero = document.getElementById('hero');
    if (!evento || !hero) return;
    if (!marcadorCampana) {
      marcadorCampana = document.createComment('lugar de la campaña');
      evento.before(marcadorCampana);
    }
    if (noche) hero.after(evento);
    else marcadorCampana.after(evento);
    window.ScrollTrigger?.refresh();
  }

  function iniciarTema() {
    aplicarTema(almacen.leer(CLAVE_TEMA, 'casona'));
    document.querySelectorAll('[data-tema-switch]').forEach((s) =>
      s.addEventListener('click', () => {
        const nuevo = document.body.dataset.theme === 'navidad' ? 'casona' : 'navidad';
        almacen.guardar(CLAVE_TEMA, nuevo);
        aplicarTema(nuevo);
        toast(nuevo === 'navidad' ? 'Bienvenido a la Navidad en la casona' : 'De vuelta a la Casona Clásica');
      })
    );
  }

  /* Nieve en el hero (solo se ve con el tema Navidad). */
  function iniciarNieve() {
    const hero = document.querySelector('.hero');
    if (!hero || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const capa = document.createElement('div');
    capa.className = 'nieve';
    capa.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 24; i += 1) {
      const copo = document.createElement('span');
      copo.style.setProperty('--x', `${Math.random() * 100}%`);
      copo.style.setProperty('--tam', `${2 + Math.random() * 4}px`);
      copo.style.setProperty('--dur', `${7 + Math.random() * 8}s`);
      copo.style.setProperty('--retraso', `${-Math.random() * 14}s`);
      copo.style.setProperty('--deriva', `${Math.round((Math.random() - 0.5) * 120)}px`);
      capa.appendChild(copo);
    }
    hero.appendChild(capa);
  }

  /* ---------- Portal: cortinas de terciopelo entre la casona y la carta ---------- */
  const movimientoReducido = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function iniciarPortal() {
    document.body.insertAdjacentHTML('beforeend', `
      <div class="portal" aria-hidden="true">
        <div class="portal__cortina portal__cortina--izq"></div>
        <div class="portal__cortina portal__cortina--der"></div>
        <div class="portal__luz"></div>
        <p class="portal__marca">BORGOROSSO</p>
      </div>`);
    const portal = document.querySelector('.portal');

    /* Al llegar a la carta, las cortinas empiezan cerradas y se abren. */
    if (document.body.classList.contains('pagina-carta') && !movimientoReducido()) {
      portal.classList.add('is-cerrado');
      void portal.offsetWidth; // fija el estado cerrado antes de animar
      setTimeout(() => {
        portal.classList.remove('is-cerrado');
        portal.classList.add('is-abriendo');
        setTimeout(() => portal.classList.remove('is-abriendo'), 1600);
      }, 120);
    }

    document.querySelectorAll('[data-portal]').forEach((enlace) =>
      enlace.addEventListener('click', (e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        const destino = enlace.getAttribute('href');
        if (movimientoReducido()) {
          window.location.href = destino;
          return;
        }
        portal.classList.add('is-cerrando');
        setTimeout(() => { window.location.href = destino; }, 1150);
      })
    );

    /* Si el usuario vuelve con el botón Atrás, la página no debe quedar tapada. */
    window.addEventListener('pageshow', (e) => {
      if (e.persisted) portal.classList.remove('is-cerrando');
    });
  }

  /* ---------- Carta: capítulos y diseño editorial ---------- */
  const NUMERALES = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

  function filaPlato(p) {
    const precioInicial = p.variantes ? p.variantes[0].precio : p.precio;
    const timbres = p.variantes
      ? `<div class="timbres" role="group" aria-label="Elige la porción de ${escapar(p.nombre)}">
          ${p.variantes.map((v, i) =>
            `<button type="button" class="timbre" data-variante="${escapar(v.nombre)}" data-precio="${v.precio}" aria-pressed="${i === 0}">${escapar(v.nombre)}</button>`
          ).join('')}
        </div>`
      : '';

    return `
      <article class="obra${p.destacado ? ' obra--marco' : ''}">
        ${p.destacado ? `<span class="obra__etiqueta">${escapar(p.destacado)}</span>` : ''}
        <div class="obra__linea">
          <h3 class="obra__nombre">${escapar(p.nombre)}</h3>
          <span class="obra__puntos" aria-hidden="true"></span>
          <span class="obra__precio" data-precio-visible>S/ ${precioInicial}</span>
        </div>
        <p class="obra__desc">${escapar(p.desc)}</p>
        ${timbres}
        <button type="button" class="sello" data-add="${p.id}" aria-label="${mesaActual() ? 'Sumar' : 'Agregar'} ${escapar(p.nombre)} ${mesaActual() ? 'a la mesa' : 'a tu pedido'}">
          <span aria-hidden="true">+</span>${mesaActual() ? 'Sumar a la mesa' : 'Agregar al pedido'}
        </button>
      </article>`;
  }

  function iniciarCarta() {
    const pagina = document.getElementById('carta-pagina');
    if (!pagina) return;

    const capitulos = document.querySelectorAll('.capitulo');
    const titulo = document.getElementById('carta-titulo-cat');
    const numero = document.getElementById('carta-num-cat');
    const destacados = document.getElementById('carta-destacados');
    const lista = document.getElementById('carta-grid');
    let actual = null;

    const pintar = (cat) => {
      const indice = CATEGORIAS.findIndex((c) => c.id === cat);
      const platos = CARTA.filter((p) => p.cat === cat);
      titulo.textContent = CATEGORIAS[indice].nombre;
      numero.textContent = NUMERALES[indice];
      destacados.innerHTML = platos.filter((p) => p.destacado).map(filaPlato).join('');
      lista.innerHTML = platos.filter((p) => !p.destacado).map(filaPlato).join('');
    };

    /* Cambio de capítulo con efecto de "pasar página". */
    const cambiar = (cat) => {
      if (cat === actual) return;
      const esPrimera = actual === null;
      actual = cat;
      capitulos.forEach((c) => {
        const activo = c.dataset.cat === cat;
        c.classList.toggle('is-active', activo);
        if (activo) c.setAttribute('aria-current', 'true');
        else c.removeAttribute('aria-current');
      });
      actualizarMovil(cat);

      if (esPrimera || movimientoReducido()) {
        pintar(cat);
        return;
      }
      pagina.classList.remove('is-entrando');
      pagina.classList.add('is-saliendo');
      setTimeout(() => {
        if (actual !== cat) return; // otro capítulo fue elegido mientras tanto
        pintar(cat);
        pagina.classList.remove('is-saliendo');
        void pagina.offsetWidth; // reinicia la animación de entrada
        pagina.classList.add('is-entrando');
        const inicio = pagina.getBoundingClientRect().top + window.scrollY - 150;
        if (window.scrollY > inicio) window.scrollTo({ top: inicio, behavior: 'smooth' });
      }, 380);
    };

    capitulos.forEach((c) => c.addEventListener('click', () => cambiar(c.dataset.cat)));

    /* Celular: una barra dice en qué sección estás, flechas para avanzar y una hoja con las 7. */
    const flecha = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    const barra = document.createElement('div');
    barra.className = 'capitulo-movil';
    barra.innerHTML = `
      <button type="button" class="capitulo-movil__flecha" data-paso="-1" aria-label="Sección anterior">${flecha('M15 5l-7 7 7 7')}</button>
      <button type="button" class="capitulo-movil__actual" aria-haspopup="dialog" aria-controls="capitulo-hoja">
        <span class="capitulo-movil__num"></span>
        <span class="capitulo-movil__texto"><span class="capitulo-movil__nombre"></span><span class="capitulo-movil__pos"></span></span>
        <span class="capitulo-movil__abrir">${flecha('M6 9l6 6 6-6')}</span>
      </button>
      <button type="button" class="capitulo-movil__flecha" data-paso="1" aria-label="Sección siguiente">${flecha('M9 5l7 7-7 7')}</button>`;
    document.querySelector('.capitulos')?.after(barra);

    const hoja = document.createElement('dialog');
    hoja.className = 'capitulo-hoja';
    hoja.id = 'capitulo-hoja';
    hoja.setAttribute('aria-label', 'Secciones de la carta');
    hoja.innerHTML = `
      <p class="capitulo-hoja__titulo">Secciones de la carta</p>
      <ul>${CATEGORIAS.map((c, i) => `
        <li><button type="button" data-cat="${c.id}">
          <span class="capitulo-hoja__num">${NUMERALES[i]}</span>
          <span class="capitulo-hoja__nombre">${escapar(c.nombre)}</span>
          <span class="capitulo-hoja__cuenta">${CARTA.filter((p) => p.cat === c.id).length} platos</span>
        </button></li>`).join('')}
      </ul>`;
    document.body.appendChild(hoja);

    function actualizarMovil(cat) {
      const i = CATEGORIAS.findIndex((c) => c.id === cat);
      barra.querySelector('.capitulo-movil__num').textContent = NUMERALES[i];
      barra.querySelector('.capitulo-movil__nombre').textContent = CATEGORIAS[i].nombre;
      barra.querySelector('.capitulo-movil__pos').textContent = `${i + 1} de ${CATEGORIAS.length}`;
      barra.querySelector('.capitulo-movil__actual').setAttribute('aria-label', `Sección ${i + 1} de ${CATEGORIAS.length}: ${CATEGORIAS[i].nombre}. Ver todas las secciones`);
      barra.querySelector('[data-paso="-1"]').disabled = i === 0;
      barra.querySelector('[data-paso="1"]').disabled = i === CATEGORIAS.length - 1;
      hoja.querySelectorAll('[data-cat]').forEach((b) => {
        if (b.dataset.cat === cat) b.setAttribute('aria-current', 'true');
        else b.removeAttribute('aria-current');
      });
    }

    barra.addEventListener('click', (e) => {
      const paso = e.target.closest('[data-paso]');
      if (paso) {
        const siguiente = CATEGORIAS[CATEGORIAS.findIndex((c) => c.id === actual) + Number(paso.dataset.paso)];
        if (siguiente) cambiar(siguiente.id);
        return;
      }
      if (e.target.closest('.capitulo-movil__actual')) hoja.showModal();
    });
    hoja.addEventListener('click', (e) => {
      const opcion = e.target.closest('[data-cat]');
      if (opcion) {
        hoja.close();
        cambiar(opcion.dataset.cat);
      } else if (e.target === hoja) {
        hoja.close(); // tocar fuera de la hoja la cierra
      }
    });

    pagina.addEventListener('click', (e) => {
      const timbre = e.target.closest('.timbre');
      if (timbre) {
        const obra = timbre.closest('.obra');
        obra.querySelectorAll('.timbre').forEach((t) => t.setAttribute('aria-pressed', String(t === timbre)));
        obra.querySelector('[data-precio-visible]').textContent = `S/ ${timbre.dataset.precio}`;
        return;
      }

      const sello = e.target.closest('[data-add]');
      if (!sello) return;
      const elegido = sello.closest('.obra').querySelector('.timbre[aria-pressed="true"]');
      const variante = elegido ? elegido.dataset.variante : '';
      if (!agregarAlCarrito(sello.dataset.add, variante)) return;

      toast(`${mesaActual() ? 'Sumado a la mesa' : 'Agregado a tu pedido'}: ${CATALOGO.get(sello.dataset.add).nombre}${variante ? ` (${variante})` : ''}`);
      sello.classList.add('is-sellado');
      setTimeout(() => sello.classList.remove('is-sellado'), 600);
      const hud = document.getElementById('carrito-fab');
      hud?.classList.add('is-rebotando');
      setTimeout(() => hud?.classList.remove('is-rebotando'), 600);
    });

    cambiar('entrantes');
  }

  /* Halo de luz de vela: sigue al mouse; en pantallas táctiles acompaña el scroll. */
  function iniciarLuzDeVela() {
    const pliego = document.getElementById('pliego');
    if (!pliego) return;

    const mover = (x, y) => {
      pliego.style.setProperty('--luz-x', `${Math.round(x)}px`);
      pliego.style.setProperty('--luz-y', `${Math.round(y)}px`);
    };

    pliego.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      const r = pliego.getBoundingClientRect();
      mover(e.clientX - r.left, e.clientY - r.top);
    });

    const conPuntero = window.matchMedia('(hover: hover)');
    const porScroll = () => {
      if (conPuntero.matches) return;
      const r = pliego.getBoundingClientRect();
      mover(r.width / 2, window.innerHeight * 0.45 - r.top);
    };
    window.addEventListener('scroll', porScroll, { passive: true });
    porScroll();
  }

  /* ---------- Comanda: líneas del pedido ---------- */
  function pintarCarrito() {
    const items = getCarrito();
    const total = totalCarrito(items);
    document.querySelectorAll('[data-carrito-cantidad]').forEach((el) => { el.textContent = cantidadCarrito(items); });
    document.querySelectorAll('[data-carrito-total]').forEach((el) => { el.textContent = `S/ ${total}`; });

    const lista = document.getElementById('drawer-items');
    if (!lista) return;
    lista.innerHTML = items.length
      ? items.map((i) => `
        <li class="linea-comanda">
          <span class="linea-comanda__cant">${i.cantidad}×</span>
          <div class="linea-comanda__info">
            <strong>${escapar(i.nombre)}</strong>
            ${i.variante ? `<small>${escapar(i.variante)}</small>` : ''}
          </div>
          <span class="linea-comanda__precio">S/ ${i.precio * i.cantidad}</span>
          <div class="controles">
            <button type="button" data-cambiar="${escapar(i.key)}" data-delta="-1" aria-label="Quitar uno de ${escapar(i.nombre)}">−</button>
            <button type="button" data-cambiar="${escapar(i.key)}" data-delta="1" aria-label="Añadir uno de ${escapar(i.nombre)}">+</button>
          </div>
        </li>`).join('')
      : '<li class="vacio">Aún no hay platos. Elige los que quieras y agrégalos.</li>';

    const subtotal = document.getElementById('drawer-total');
    if (subtotal) subtotal.textContent = `S/ ${total}`;
  }

  function iniciarCarrito() {
    if (!document.getElementById('carrito-drawer')) return;

    document.querySelectorAll('[data-abrir-carrito]').forEach((b) => b.addEventListener('click', abrirCarrito));
    document.querySelectorAll('[data-cerrar-drawer]').forEach((b) => b.addEventListener('click', cerrarCarrito));
    document.getElementById('drawer-overlay')?.addEventListener('click', cerrarCarrito);

    document.getElementById('drawer-items').addEventListener('click', (e) => {
      const boton = e.target.closest('[data-cambiar]');
      if (boton) cambiarCantidad(boton.dataset.cambiar, Number(boton.dataset.delta));
    });

    window.addEventListener('carrito:cambio', pintarCarrito);
    window.addEventListener('storage', (e) => { if (e.key === CLAVES.carrito) pintarCarrito(); });
    pintarCarrito();
  }

  /* ---------- Comanda: ticket y envío (In Situ / Delivery / Reserva) ---------- */
  function mostrarTicket(datos) {
    const modal = document.getElementById('modal-ticket');
    if (!modal) return;
    const filas = [['Ticket', datos.ticket], ['Cliente', datos.nombre], ['Modalidad', datos.modalidad], ...datos.filas];

    document.getElementById('ticket-contenido').innerHTML = `
      <p class="eyebrow">Comanda registrada</p>
      <h2 class="titulo modal__titulo">Borgorosso</h2>
      <dl class="ticket__datos">
        ${filas.map(([k, v]) => `<div><dt>${escapar(k)}</dt><dd>${escapar(v)}</dd></div>`).join('')}
      </dl>
      <ul class="ticket__lineas">
        ${datos.detalle.map((l) => `<li>${escapar(l)}</li>`).join('')}
      </ul>
      <p class="ticket__total">Total <span>S/ ${datos.total}</span></p>
      ${datos.notas ? `<p class="nota">Notas: ${escapar(datos.notas)}</p>` : ''}
      <a class="btn-vino w-full" href="${datos.url}" target="_blank" rel="noopener">${datos.etiqueta || '📲 Confirmar por WhatsApp'}</a>
      <p class="nota">Quedó guardada en tu historial de cliente.</p>`;

    abrirModal(modal);
  }

  function iniciarPedidoCarta() {
    const form = document.getElementById('pedido-form');
    if (!form) return;

    const bloques = {
      insitu: document.getElementById('bloque-insitu'),
      delivery: document.getElementById('bloque-delivery')
    };
    const textosBoton = {
      insitu: 'Registrar comanda en mesa',
      delivery: 'Enviar pedido por WhatsApp'
    };
    const avisoHora = document.getElementById('aviso-hora');
    const gpsInfo = document.getElementById('pedido-gps-info');
    const enviar = form.querySelector('[type="submit"]');
    let ubicacionGPS = null;

    /* Con la mesa del QR la comanda no la pregunta: el pedido va directo a esa mesa. */
    const mesaQR = mesaActual();
    if (mesaQR) {
      form.elements.mesa.value = mesaQR;
      form.elements.mesa.readOnly = true;
      form.querySelector('#bloque-insitu .campo > span').textContent = `Mesa Nº ${mesaQR} · detectada por el QR`;
      const miCuenta = `mesa.html?mesa=${mesaQR}&ver=pedido`;
      document.querySelector('.pliego__cabecera')?.insertAdjacentHTML('beforeend',
        `<p class="pliego__mesa">Estás en la <strong>Mesa ${mesaQR}</strong>. Tu pedido llega directo a cocina.
          <a class="pliego__mesa-enlace" href="${miCuenta}">Ver mi pedido y cuenta</a></p>`);
      /* Sentado en la mesa no hace falta reservar: ese botón lleva a su pedido y cuenta. */
      const reservar = document.querySelector('.hud-reservar');
      if (reservar) {
        const cuenta = document.createElement('a');
        cuenta.className = 'hud-reservar';
        cuenta.href = miCuenta;
        cuenta.setAttribute('aria-label', 'Ver mi pedido y cuenta');
        cuenta.innerHTML = '<svg class="hud-reservar__icono" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M9 8h6M9 12h6M9 16h3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg><span class="hud-reservar__txt">Mi cuenta</span>';
        reservar.replaceWith(cuenta);
      }
    }

    /* Regla: con QR se pide a esa mesa; desde la web (sin QR) solo delivery. */
    document.getElementById('drawer-titulo').textContent = mesaQR ? 'Comanda de Mesa' : 'Tu Pedido';
    document.getElementById('carrito-fab')?.setAttribute('aria-label', mesaQR ? 'Abrir la comanda de la mesa' : 'Abrir tu pedido');
    const opcion = (valor) => form.querySelector(`input[name="modalidad"][value="${valor}"]`);
    const modoFijo = mesaQR ? 'insitu' : 'delivery';
    const leyenda = form.querySelector('.modos legend');
    opcion(mesaQR ? 'delivery' : 'insitu').closest('.modo').hidden = true;
    opcion(modoFijo).checked = true;
    if (mesaQR) {
      leyenda.textContent = `Pedido para la Mesa ${mesaQR}`;
      leyenda.insertAdjacentHTML('afterend', '<button type="button" class="modo-cambiar" data-olvidar-mesa>¿Ya no estás en la casona? Pedir delivery</button>');
      form.querySelector('[data-olvidar-mesa]').addEventListener('click', () => {
        olvidarMesa();
        location.href = 'carta.html';
      });
    } else {
      leyenda.textContent = 'Pedido a domicilio';
      leyenda.insertAdjacentHTML('afterend', '<p class="modo-nota">¿Estás en la casona? Escanea el QR de tu mesa para pedir desde ella.</p>');
    }


    const actualizarModalidad = () => {
      const modo = form.elements.modalidad.value;
      Object.entries(bloques).forEach(([clave, bloque]) => { bloque.hidden = clave !== modo; });
      const sinDelivery = modo === 'delivery' && !deliveryDisponible();
      avisoHora.hidden = !sinDelivery;
      enviar.disabled = sinDelivery;
      enviar.textContent = textosBoton[modo];
    };
    form.addEventListener('change', actualizarModalidad);
    actualizarModalidad();

    document.getElementById('pedido-gps').addEventListener('click', async () => {
      gpsInfo.textContent = 'Buscando tu ubicación…';
      try {
        ubicacionGPS = await obtenerUbicacion();
        gpsInfo.textContent = `Ubicación capturada ✔ (${ubicacionGPS.lat}, ${ubicacionGPS.lng})`;
      } catch (err) {
        ubicacionGPS = null;
        gpsInfo.textContent = `${err.message} Puedes escribir tu dirección.`;
      }
    });

    let enviandoComanda = false;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (enviandoComanda) return; // un doble toque no debe duplicar la comanda
      const items = getCarrito();
      const error = document.getElementById('pedido-error');
      const modo = form.elements.modalidad.value;
      const nombre = form.elements.nombre.value.trim().replace(/\s+/g, ' ');
      const notas = form.elements.notas.value.trim();
      const mesa = form.elements.mesa.value.trim();
      const direccion = form.elements.direccion.value.trim();

      let problema = '';
      if (!items.length) problema = 'Tu comanda está vacía: suma al menos un plato.';
      else if (!claveCliente(nombre)) problema = 'Escribe tu nombre para la comanda.';
      else if (modo === 'insitu' && !numeroMesa(mesa)) problema = 'Indica tu número de mesa, por ejemplo 5.';
      else if (modo === 'delivery' && !deliveryDisponible()) problema = 'El delivery sale a partir de las 12:00 PM.';
      else if (modo === 'delivery' && !direccion && !ubicacionGPS) problema = 'Escribe tu dirección o comparte tu ubicación GPS.';
      if (problema) {
        error.textContent = problema;
        return;
      }
      error.textContent = '';

      const { cliente } = identificarCliente(nombre);
      let ticket = `BG-${Date.now().toString(36).toUpperCase().slice(-5)}`;
      const detalle = lineasCarrito(items);
      let total = totalCarrito(items);
      let modalidad;
      let filas;
      let url;
      let etiqueta = '';

      if (modo === 'insitu') {
        const enviar = form.querySelector('[type="submit"]');
        const textoEnviar = enviar.textContent;
        enviandoComanda = true;
        enviar.disabled = true;
        enviar.textContent = 'Enviando a cocina…';
        try {
          const { pedido, seguimiento } = await enviarACocina({ mesa, cliente: cliente.nombre, items, notas });
          ticket = `#${pedido.numero}`;
          total = pedido.total;
          url = seguimiento;
          etiqueta = 'Ver mi pedido y pagar';
          modalidad = 'En mesa · un mozo confirmará tu mesa';
          filas = [['Mesa', numeroMesa(mesa)]];
          guardarEnHistorial('pedido', { ticket, modalidad, mesa, ubicacion: '', detalle, total, notas });
        } catch {
          error.textContent = 'No pudimos enviar tu comanda a cocina. Revisa tu conexión e inténtalo de nuevo.';
          return;
        } finally {
          enviandoComanda = false;
          enviar.disabled = false;
          enviar.textContent = textoEnviar;
        }
      } else {
        modalidad = 'Delivery a domicilio';
        const ubicacion = [direccion, ubicacionGPS && ubicacionGPS.url].filter(Boolean).join(' · ');
        const datos = { ticket, modalidad, mesa: '', ubicacion, detalle, total, notas };
        guardarEnHistorial('pedido', datos);
        url = waLink(textoPedido({ nombre: cliente.nombre, ...datos }));
        filas = [['Entrega', ubicacion]];
      }

      guardarCarrito([]);
      form.reset();
      if (mesaQR) form.elements.mesa.value = mesaQR;
      opcion(modoFijo).checked = true;
      ubicacionGPS = null;
      gpsInfo.textContent = '';
      actualizarModalidad();
      cerrarCarrito();

      mostrarTicket({ ticket, nombre: cliente.nombre, modalidad, filas, detalle, total, notas, url, etiqueta });
      if (modo !== 'insitu') window.open(url, '_blank', 'noopener');
    });
  }

  /* ---------- Evento: cuenta regresiva ---------- */
  function iniciarCuentaRegresiva() {
    const raiz = document.querySelector('[data-countdown]');
    if (!raiz) return;
    const destino = new Date(EVENTO.inicio).getTime();
    let temporizador;

    const pintar = () => {
      const diff = Math.max(0, destino - Date.now());
      const valores = {
        dias: Math.floor(diff / 86400000),
        horas: Math.floor(diff / 3600000) % 24,
        minutos: Math.floor(diff / 60000) % 60,
        segundos: Math.floor(diff / 1000) % 60
      };
      Object.entries(valores).forEach(([unidad, valor]) => {
        const el = raiz.querySelector(`[data-u="${unidad}"]`);
        if (el) el.textContent = pad(valor);
      });
      if (diff === 0) clearInterval(temporizador);
    };

    pintar();
    temporizador = setInterval(pintar, 1000);
  }

  /* ---------- Comunes: nav, revelado, GSAP ---------- */
  function iniciarNavegacion() {
    const header = document.querySelector('.site-header');
    const alternar = document.getElementById('nav-toggle');
    const menuMovil = document.getElementById('menu-movil');

    const alScrollear = () => header?.classList.toggle('is-scrolled', window.scrollY > 40);
    window.addEventListener('scroll', alScrollear, { passive: true });
    alScrollear();

    alternar?.addEventListener('click', () => {
      const abierto = menuMovil.classList.toggle('is-open');
      alternar.setAttribute('aria-expanded', String(abierto));
    });
    menuMovil?.querySelectorAll('a').forEach((a) =>
      a.addEventListener('click', () => menuMovil.classList.remove('is-open'))
    );
  }

  function iniciarRevelado() {
    const items = document.querySelectorAll('.reveal');
    if (!('IntersectionObserver' in window)) {
      items.forEach((i) => i.classList.add('is-visible'));
      return;
    }
    const observador = new IntersectionObserver((entradas) => {
      entradas.forEach((en) => {
        if (en.isIntersecting) {
          en.target.classList.add('is-visible');
          observador.unobserve(en.target);
        }
      });
    }, { threshold: 0.15 });
    items.forEach((i) => observador.observe(i));
  }

  /* Animaciones opcionales: si GSAP no carga, la página se ve igual sin ellas. */
  function iniciarGSAP() {
    if (!window.gsap) return;
    if (document.querySelector('.hero-anim')) {
      const entrada = window.gsap.from('.hero-anim', { opacity: 0, y: 30, stagger: 0.15, duration: 1.1, ease: 'power2.out' });
      /* Seguro: si el navegador frena la animación, el titular nunca queda invisible. */
      setTimeout(() => entrada.progress(1), 2500);
    }
    if (window.ScrollTrigger && document.querySelector('[data-parallax]')) {
      window.gsap.registerPlugin(window.ScrollTrigger);
      window.gsap.utils.toArray('[data-parallax]').forEach((el) => {
        window.gsap.to(el, {
          yPercent: Number(el.dataset.parallax) || -15,
          ease: 'none',
          scrollTrigger: { trigger: el.parentElement, scrub: true }
        });
      });
    }
  }

  /* Botón magnético: sigue levemente al cursor (solo con mouse y sin movimiento reducido). */
  function iniciarBotonesMagneticos() {
    if (!window.matchMedia('(hover: hover)').matches || movimientoReducido()) return;
    document.querySelectorAll('[data-magnetico]').forEach((boton) => {
      boton.addEventListener('pointermove', (e) => {
        const r = boton.getBoundingClientRect();
        const x = (e.clientX - r.left - r.width / 2) * 0.25;
        const y = (e.clientY - r.top - r.height / 2) * 0.35;
        boton.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      });
      boton.addEventListener('pointerleave', () => { boton.style.transform = ''; });
    });
  }

  /* ---------- Eventos globales ---------- */
  function iniciarEventosGlobales() {
    document.querySelectorAll('[data-reservar]').forEach((b) =>
      b.addEventListener('click', () => abrirReserva({ tipo: b.dataset.reservar }))
    );
    document.querySelectorAll('.modal').forEach((modal) => {
      modal.querySelectorAll('[data-cerrar-modal]').forEach((b) =>
        b.addEventListener('click', () => cerrarModal(modal))
      );
      modal.addEventListener('click', (e) => { if (e.target === modal) cerrarModal(modal); });
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      document.querySelectorAll('.modal.is-open').forEach(cerrarModal);
      cerrarCarrito();
    });
  }

  /* ---------- API pública ---------- */
  window.Borgorosso = {
    NEGOCIO, EVENTO, MOTIVOS, ZONAS, CARTA, CATEGORIAS,
    normalizar, escapar, claveCliente, formatearFecha, ahoraLima, aMinutos,
    dentroDeHorario, deliveryDisponible, eventoVigente, esTemporadaNavidad,
    getCarrito, agregarAlCarrito, cambiarCantidad, totalCarrito, cantidadCarrito, lineasCarrito,
    obtenerUbicacion,
    getClienteActivo, identificarCliente, cerrarSesionCliente, guardarEnHistorial,
    waLink, textoPedido, textoReserva, textoBanquete,
    numeroMesa, mesaActual, olvidarMesa, enviarACocina, vaciarCarrito: () => guardarCarrito([]),
    abrirReserva, abrirCarrito, cerrarCarrito, toast
  };

  document.addEventListener('DOMContentLoaded', () => {
    iniciarTema();
    montarModalReserva();
    iniciarPortal();
    iniciarEventosGlobales();
    iniciarNavegacion();
    iniciarRevelado();
    iniciarNieve();
    iniciarCuentaRegresiva();
    iniciarCarta();
    iniciarLuzDeVela();
    iniciarCarrito();
    iniciarPedidoCarta();
    iniciarGSAP();
    iniciarBotonesMagneticos();
    const anio = document.getElementById('anio');
    if (anio) anio.textContent = new Date().getFullYear();
  });
})();
