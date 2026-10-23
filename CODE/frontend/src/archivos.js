import { api } from './api.js';

// Los archivos (PDF) llegan como JSON { archivo, tipo, base64 } y se arman aquí. No se piden como application/pdf
// porque gestores de descarga como IDM interceptan esa respuesta, la repiden sin sesión y el archivo llega vacío.
async function pedirArchivo(path) {
  const { archivo, tipo, base64 } = await api.get(path);
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return { archivo, blob: new Blob([bytes], { type: tipo }) };
}

// La URL temporal no se puede revocar de inmediato: el navegador aún no leyó el archivo.
const liberarLuego = (url) => setTimeout(() => URL.revokeObjectURL(url), 60_000);

export async function descargarArchivo(path, nombre) {
  const { archivo, blob } = await pedirArchivo(path);
  const url = URL.createObjectURL(blob);
  const enlace = Object.assign(document.createElement('a'), { href: url, download: nombre || archivo });
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  liberarLuego(url);
}

// Abre el archivo en una pestaña nueva. La pestaña se abre antes de pedir el archivo (dentro del clic)
// para que el bloqueador de ventanas emergentes no la impida.
export async function verArchivo(path) {
  const ventana = window.open('', '_blank');
  try {
    const { blob } = await pedirArchivo(path);
    const url = URL.createObjectURL(blob);
    if (ventana) ventana.location.href = url;
    else window.location.href = url;
    liberarLuego(url);
  } catch (err) {
    ventana?.close();
    throw err;
  }
}

// Abre el diálogo de impresión del navegador con el documento. El PDF se carga en un marco invisible de la misma
// página (sin abrir pestañas) y se imprime al terminar de cargar. Si el navegador no deja imprimir desde el marco,
// se abre el documento en una pestaña, donde basta Ctrl+P.
export async function imprimirArchivo(path) {
  const { blob } = await pedirArchivo(path);
  const url = URL.createObjectURL(blob);
  const marco = document.createElement('iframe');
  marco.setAttribute('aria-hidden', 'true');
  marco.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none;';
  marco.onload = () => {
    try {
      marco.contentWindow.focus();
      marco.contentWindow.print();
    } catch {
      window.open(url, '_blank');
    }
  };
  marco.src = url;
  document.body.appendChild(marco);
  setTimeout(() => { marco.remove(); URL.revokeObjectURL(url); }, 5 * 60_000);
}
