// Ley 20.956 (Chile): los pagos en efectivo se redondean al múltiplo de $10 más cercano; terminaciones 1 a 4 bajan y
// 5 a 9 suben. Solo rige para el efectivo: tarjetas y transferencias se pagan por el monto exacto.
// Los cálculos van en centavos enteros para no arrastrar errores de coma flotante.
export const aCentavos = (v) => Math.round(Number(v) * 100);
export const aPesos = (centavos) => centavos / 100;

// Centavos -> centavos redondeados al múltiplo de $10 (1000 centavos). 3.094 -> 3.090; 3.095 -> 3.100.
export const redondearEfectivo = (centavos) => Math.floor((centavos + 500) / 1000) * 1000;

// Ajuste por redondeo sobre un monto en efectivo (en pesos): -4 si se cobra de menos, +5 si se cobra de más.
export const ajusteRedondeo = (pesos) => aPesos(redondearEfectivo(aCentavos(pesos)) - aCentavos(pesos));

// Monto en pesos para mensajes: $3.090.
export const pesos = (n) => `$${Number(n).toLocaleString('es-CL')}`;
