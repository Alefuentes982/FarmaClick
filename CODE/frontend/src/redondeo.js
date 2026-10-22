// Ley 20.956 (Chile): el efectivo se paga redondeado al múltiplo de $10 más cercano (1 a 4 baja, 5 a 9 sube).
// Mismo cálculo que backend/src/core/redondeo.js; el backend es quien valida el monto.
export const redondearEfectivo = (pesos) => Math.floor((Math.round(Number(pesos) * 100) + 500) / 1000) * 10;

// Texto del ajuste con signo: "-$4" / "+$5".
export const textoAjuste = (n, formato) => `${n < 0 ? '-' : '+'}${formato(Math.abs(n))}`;
