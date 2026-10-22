// Monto en pesos escrito en palabras, para confirmar lo digitado en la apertura y el cierre de caja:
// 2000000 -> "dos millones de pesos"; 55783 -> "cincuenta y cinco mil setecientos ochenta y tres pesos".
const UNIDADES = ['cero', 'un', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce',
  'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte', 'veintiún', 'veintidós',
  'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve'];
const DECENAS = ['', '', 'veinte', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
const CENTENAS = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos',
  'ochocientos', 'novecientos'];

// 0..999 (usa "un" y "veintiún": así se dice ante "mil", "millones" y "pesos").
function hastaMil(n) {
  if (n === 0) return '';
  if (n === 100) return 'cien';
  const c = Math.floor(n / 100);
  const r = n % 100;
  let texto = '';
  if (r < 30) texto = r ? UNIDADES[r] : '';
  else texto = DECENAS[Math.floor(r / 10)] + (r % 10 ? ` y ${UNIDADES[r % 10]}` : '');
  return [CENTENAS[c], texto].filter(Boolean).join(' ');
}

function hastaMillon(n) {
  const miles = Math.floor(n / 1000);
  const resto = n % 1000;
  const parteMiles = miles === 0 ? '' : miles === 1 ? 'mil' : `${hastaMil(miles)} mil`;
  return [parteMiles, hastaMil(resto)].filter(Boolean).join(' ');
}

export function montoEnPalabras(valor) {
  const n = Math.round(Math.abs(Number(valor) || 0));
  if (n === 0) return 'cero pesos';
  if (n === 1) return 'un peso';
  const millones = Math.floor(n / 1_000_000);
  const resto = n % 1_000_000;
  const parteMillones = millones === 0 ? '' : millones === 1 ? 'un millón' : `${hastaMillon(millones)} millones`;
  const texto = [parteMillones, hastaMillon(resto)].filter(Boolean).join(' ');
  // "dos millones de pesos", pero "dos millones cien pesos".
  return `${texto}${millones > 0 && resto === 0 ? ' de' : ''} pesos`;
}
