// Generador de documentos comerciales en PDF (órdenes de compra hoy; pedidos y otros después).
// Recibe datos ya armados: no conoce tablas ni rutas, solo el formato del documento.
import { readFileSync } from 'node:fs';
import PDFDocument from 'pdfkit';

// Número correlativo con formato de documento: formatoNumero('OC', 123) -> "OC-000123".
export const formatoNumero = (prefijo, n) => `${prefijo}-${String(n).padStart(6, '0')}`;

const COLOR = { texto: '#212529', suave: '#6c757d', linea: '#ced4da', acento: '#0d6efd', fondo: '#f1f3f5', alerta: '#dc3545' };
const MARGEN = 40;
const MARCA = ['#74109E', '#4BACAB', '#A3C940']; // morado, turquesa y verde del logo

// Logo oficial (PNG con transparencia, 1200 x 282). Se lee una vez al cargar el módulo; si faltara el archivo,
// el encabezado vuelve a mostrar el nombre en texto y el documento se genera igual.
const LOGO = (() => {
  try { return readFileSync(new URL('./recursos/farmaclick-logo.png', import.meta.url)); } catch { return null; }
})();
const LOGO_ALTO = 30; // puntos (≈ 10,6 mm); el ancho sale de la proporción del logo (≈ 128 pt)

export const clp = (v) => `$ ${new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(Number(v ?? 0))}`;
export const fechaDMA = (v) => {
  if (!v) return '—';
  const s = String(v);
  // Las columnas DATE llegan como AAAA-MM-DD: se formatean sin pasar por zonas horarias.
  if (/^\d{4}-\d{2}-\d{2}$/.test(s.slice(0, 10)) && (s.length === 10 || s.includes('T00:00:00'))) {
    return s.slice(0, 10).split('-').reverse().join('-');
  }
  return new Date(v).toLocaleDateString('es-CL', { timeZone: 'America/Santiago', day: '2-digit', month: '2-digit', year: 'numeric' }).replaceAll('/', '-');
};

/**
 * @param {object} d
 * @param {string} d.titulo        "ORDEN DE COMPRA"
 * @param {string} d.codigo        "OC-000123"
 * @param {{nombre:string, lineas?:string[]}} d.emisor
 * @param {{titulo:string, lineas:string[]}[]} d.partes   cuadros de información (proveedor, destino…)
 * @param {[string,string][]} d.metadatos                  pares etiqueta/valor bajo el encabezado
 * @param {{header:string, key:string, ancho:number, alinear?:'left'|'right'|'center'}[]} d.columnas  ancho = fracción (suman 1)
 * @param {object[]} d.filas
 * @param {[string,string][]} d.totales
 * @param {string} [d.sello]       texto grande de estado (BORRADOR, ANULADA)
 * @param {string} [d.nota]
 */
export function generarDocumentoPdf(d) {
  const doc = new PDFDocument({ size: 'A4', margin: MARGEN, bufferPages: true, info: { Title: `${d.titulo} ${d.codigo}` } });
  const ancho = doc.page.width - MARGEN * 2;
  const limite = () => doc.page.height - MARGEN - 50; // deja espacio al pie de página

  // Encabezado: logo a la izquierda (y la razón social bajo él, si la empresa no se llama FarmaClick), título y
  // código a la derecha, y una línea con los colores de la marca, como en la barra superior del sistema.
  if (LOGO) {
    doc.image(LOGO, MARGEN, MARGEN, { height: LOGO_ALTO });
    doc.y = MARGEN + LOGO_ALTO + 6;
    if (d.emisor.nombre && d.emisor.nombre !== 'FarmaClick') {
      doc.fillColor(COLOR.texto).font('Helvetica-Bold').fontSize(10).text(d.emisor.nombre, MARGEN, doc.y, { width: ancho / 2 });
    }
  } else {
    doc.fillColor(COLOR.acento).font('Helvetica-Bold').fontSize(20).text(d.emisor.nombre, MARGEN, MARGEN, { width: ancho / 2 });
  }
  doc.fillColor(COLOR.suave).font('Helvetica').fontSize(9);
  (d.emisor.lineas ?? []).forEach((l) => doc.text(l, MARGEN, doc.y, { width: ancho / 2 }));
  const finEmisor = doc.y;
  doc.fillColor(COLOR.texto).font('Helvetica-Bold').fontSize(15).text(d.titulo, MARGEN + ancho / 2, MARGEN, { width: ancho / 2, align: 'right' });
  doc.fontSize(13).fillColor(COLOR.acento).text(d.codigo, MARGEN + ancho / 2, doc.y, { width: ancho / 2, align: 'right' });
  doc.y = Math.max(doc.y, finEmisor) + 10;
  const linea = doc.linearGradient(MARGEN, 0, MARGEN + ancho, 0);
  linea.stop(0, MARCA[0]).stop(0.45, MARCA[1]).stop(1, MARCA[2]);
  doc.rect(MARGEN, doc.y, ancho, 2).fill(linea);
  doc.y += 14;

  // Metadatos (fecha, entrega esperada, emisor…) en una fila
  if (d.metadatos?.length) {
    const w = ancho / d.metadatos.length;
    const y = doc.y;
    d.metadatos.forEach(([etiqueta, valor], i) => {
      doc.font('Helvetica').fontSize(8).fillColor(COLOR.suave).text(etiqueta.toUpperCase(), MARGEN + i * w, y, { width: w - 8 });
      doc.font('Helvetica-Bold').fontSize(10).fillColor(COLOR.texto).text(valor, MARGEN + i * w, y + 11, { width: w - 8 });
    });
    doc.y = y + 34;
  }

  // Cuadros de información (proveedor / destino)
  if (d.partes?.length) {
    const w = ancho / d.partes.length;
    const y = doc.y;
    let alto = 0;
    d.partes.forEach((p, i) => {
      const texto = p.lineas.filter(Boolean).join('\n');
      alto = Math.max(alto, 26 + doc.font('Helvetica').fontSize(10).heightOfString(texto, { width: w - 28 }) + 8);
    });
    d.partes.forEach((p, i) => {
      const x = MARGEN + i * w;
      doc.roundedRect(x, y, w - 8, alto, 4).fill(COLOR.fondo);
      doc.fillColor(COLOR.suave).font('Helvetica-Bold').fontSize(8).text(p.titulo.toUpperCase(), x + 10, y + 8, { width: w - 28 });
      doc.fillColor(COLOR.texto).font('Helvetica').fontSize(10).text(p.lineas.filter(Boolean).join('\n'), x + 10, y + 22, { width: w - 28 });
    });
    doc.y = y + alto + 16;
  }

  // Tabla de líneas
  const cols = d.columnas.map((c) => ({ ...c, w: c.ancho * ancho }));
  const encabezadoTabla = () => {
    const y = doc.y;
    doc.rect(MARGEN, y, ancho, 20).fill(COLOR.acento);
    let x = MARGEN;
    cols.forEach((c) => {
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9).text(c.header, x + 5, y + 6, { width: c.w - 10, align: c.alinear ?? 'left' });
      x += c.w;
    });
    doc.y = y + 20;
  };
  encabezadoTabla();
  d.filas.forEach((fila, i) => {
    doc.font('Helvetica').fontSize(9);
    const alto = Math.max(...cols.map((c) => doc.heightOfString(String(fila[c.key] ?? ''), { width: c.w - 10 }))) + 10;
    if (doc.y + alto > limite()) { doc.addPage(); doc.y = MARGEN; encabezadoTabla(); }
    const y = doc.y;
    if (i % 2 === 1) doc.rect(MARGEN, y, ancho, alto).fill(COLOR.fondo);
    let x = MARGEN;
    cols.forEach((c) => {
      doc.fillColor(COLOR.texto).font('Helvetica').fontSize(9).text(String(fila[c.key] ?? ''), x + 5, y + 5, { width: c.w - 10, align: c.alinear ?? 'left' });
      x += c.w;
    });
    doc.y = y + alto;
  });
  doc.moveTo(MARGEN, doc.y).lineTo(MARGEN + ancho, doc.y).strokeColor(COLOR.linea).stroke();

  // Totales (a la derecha). La etiqueta ocupa la mitad del ancho (alineada a la derecha, junto al valor) y cada fila
  // mide lo que necesite su texto: una etiqueta larga, como "Ajuste por redondeo (Ley 20.956)", no pisa a la siguiente.
  const xEtiqueta = MARGEN + ancho * 0.3;
  const anchoEtiqueta = ancho * 0.5;
  const xValor = MARGEN + ancho * 0.8;
  const anchoValor = ancho * 0.2;
  const altoFila = (etiqueta, valor, ultimo) => {
    doc.font(ultimo ? 'Helvetica-Bold' : 'Helvetica').fontSize(ultimo ? 12 : 10);
    return Math.max(doc.heightOfString(etiqueta, { width: anchoEtiqueta }), doc.heightOfString(valor, { width: anchoValor })) + (ultimo ? 8 : 5);
  };
  const altoTotales = d.totales.reduce((s, [e, v], i) => s + altoFila(e, v, i === d.totales.length - 1), 0);
  if (doc.y + altoTotales + 20 > limite()) { doc.addPage(); doc.y = MARGEN; }
  doc.y += 10;
  d.totales.forEach(([etiqueta, valor], i) => {
    const ultimo = i === d.totales.length - 1;
    const alto = altoFila(etiqueta, valor, ultimo);
    const y = doc.y;
    doc.font(ultimo ? 'Helvetica-Bold' : 'Helvetica').fontSize(ultimo ? 12 : 10).fillColor(COLOR.texto);
    doc.text(etiqueta, xEtiqueta, y, { width: anchoEtiqueta, align: 'right' });
    doc.text(valor, xValor, y, { width: anchoValor, align: 'right' });
    doc.y = y + alto;
  });

  if (d.nota) {
    if (doc.y + 50 > limite()) { doc.addPage(); doc.y = MARGEN; }
    doc.y += 14;
    doc.font('Helvetica-Bold').fontSize(9).fillColor(COLOR.suave).text('OBSERVACIONES', MARGEN, doc.y);
    doc.font('Helvetica').fontSize(9).fillColor(COLOR.texto).text(d.nota, MARGEN, doc.y + 2, { width: ancho });
  }

  // Sello de estado y pie de página en todas las hojas
  const paginas = doc.bufferedPageRange();
  for (let i = 0; i < paginas.count; i++) {
    doc.switchToPage(paginas.start + i);
    if (d.sello) {
      doc.save().rotate(-30, { origin: [doc.page.width / 2, doc.page.height / 2] })
        .font('Helvetica-Bold').fontSize(80).fillColor(COLOR.alerta).opacity(0.12)
        .text(d.sello, 0, doc.page.height / 2 - 40, { width: doc.page.width, align: 'center', lineBreak: false })
        .restore();
    }
    // El pie queda en el margen inferior: se anula el margen para que pdfkit no abra otra página.
    doc.page.margins.bottom = 0;
    doc.font('Helvetica').fontSize(8).fillColor(COLOR.suave)
      .text(`${d.codigo} · ${d.emisor.nombre}`, MARGEN, doc.page.height - 36, { width: ancho / 2, lineBreak: false })
      .text(`Página ${i + 1} de ${paginas.count}`, MARGEN + ancho / 2, doc.page.height - 36, { width: ancho / 2, align: 'right', lineBreak: false });
  }
  return doc;
}

// Junta el PDF completo en memoria (los documentos comerciales son de pocas páginas).
export const pdfABuffer = (doc) => new Promise((ok, fallo) => {
  const partes = [];
  doc.on('data', (c) => partes.push(c));
  doc.on('end', () => ok(Buffer.concat(partes)));
  doc.on('error', fallo);
  doc.end();
});
