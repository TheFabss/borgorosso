// Genera carta-datos.js (web, carta virtual y pedido QR) desde carta-salon.json.
// Uso, desde la raíz del proyecto: node carta/generar-carta.js
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const carta = JSON.parse(fs.readFileSync(path.join(__dirname, 'carta-salon.json'), 'utf8'));

const CATEGORIAS = [
  { id: 'entrantes', nombre: 'Entrantes', secciones: ['del-horno', 'alitas', 'salchipapa'] },
  { id: 'fondos', nombre: 'Fondos', secciones: ['platos-fuertes', 'pollo-a-la-lena', 'pastas', 'borgo-natural', 'burger'] },
  { id: 'pizzas', nombre: 'Pizzas a la Leña', secciones: ['pizzas'] },
  { id: 'adicionales', nombre: 'Adicionales', secciones: ['guarniciones'] },
  { id: 'postres', nombre: 'Postres', secciones: ['postres'] },
  { id: 'bebidas', nombre: 'Bebidas', secciones: ['bebidas', 'vino-cerveza', 'cafe', 'infusiones'] },
  { id: 'cocteles', nombre: 'Cócteles', secciones: ['piscos', 'cocteles-autor', 'cocteles-calentitos', 'cocteles-tiki', 'cocteles-clasicos'] }
];

/* "La Obra del Chef": platos que se enmarcan como cuadro en cada capítulo. */
const DESTACADOS = {
  'panuozzo-prosciutto': 'Especialidad a la Leña',
  'alitas-ahumadas': 'Favorito de la Casa',
  'pollo-lena': 'Especialidad a la Leña',
  'costillar-res': 'Favorito de la Casa',
  'al-prosciutto': 'Especialidad a la Leña',
  rural: 'Favorito de la Casa',
  'ensalada-palta': 'Favorito de la Casa',
  'torta-chocolate': 'Favorito de la Casa',
  tiramisu: 'Receta de la Casa',
  chicha: 'Favorito de la Casa',
  humo: 'Autor de la Casa'
};

const usadas = new Set(CATEGORIAS.flatMap((c) => c.secciones));
const sinCategoria = carta.secciones.filter((s) => !usadas.has(s.id)).map((s) => s.id);
if (sinCategoria.length) throw new Error(`Secciones sin categoría web: ${sinCategoria.join(', ')}`);

const platos = CATEGORIAS.flatMap((c) => c.secciones.flatMap((id) => {
  const seccion = carta.secciones.find((s) => s.id === id);
  if (!seccion) throw new Error(`Sección inexistente en el JSON: ${id}`);
  return seccion.items.map((item) => ({
    id: item.id,
    cat: c.id,
    nombre: item.nombre,
    desc: item.descripcion,
    ...(item.precios ? { variantes: item.precios } : { precio: item.precio }),
    ...(DESTACADOS[item.id] ? { destacado: DESTACADOS[item.id] } : {})
  }));
}));

const faltantes = Object.keys(DESTACADOS).filter((id) => !platos.some((p) => p.id === id));
if (faltantes.length) throw new Error(`Destacados inexistentes: ${faltantes.join(', ')}`);

const categoriasWeb = CATEGORIAS.map(({ id, nombre }) => ({ id, nombre }));
const salida = `/* Archivo generado por carta/generar-carta.js desde carta/carta-salon.json (v${carta.meta.version}).
   No editar a mano: cambia el JSON y vuelve a generarlo. */
window.BorgoCarta = {
  CATEGORIAS: ${JSON.stringify(categoriasWeb, null, 2).replace(/\n/g, '\n  ')},
  CARTA: ${JSON.stringify(platos, null, 2).replace(/\n/g, '\n  ')}
};
`;
fs.writeFileSync(path.join(RAIZ, 'js', 'carta-datos.js'), salida);

/* Precios oficiales para el servidor: pegar supabase/02-precios.sql en el SQL Editor tras cada cambio. */
const sql = (texto) => `'${String(texto).replace(/'/g, "''")}'`;
const filas = platos.flatMap((p) => (p.variantes || [{ nombre: '', precio: p.precio }]).map((v) =>
  `  (${sql(p.id)}, ${sql(v.nombre)}, ${sql(p.nombre)}, ${v.precio})`
));
fs.writeFileSync(path.join(RAIZ, 'supabase', '02-precios.sql'), `-- Generado por carta/generar-carta.js desde carta-salon.json (v${carta.meta.version}). No editar a mano.
begin;
delete from public.precios;
insert into public.precios (plato_id, variante, nombre, precio) values
${filas.join(',\n')};
commit;
`);
console.log(`carta-datos.js generado: ${platos.length} platos, ${categoriasWeb.length} categorías`);
