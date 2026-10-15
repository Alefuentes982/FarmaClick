// Valida el dígito verificador y devuelve el RUT normalizado ("12345678-5"), o null si es inválido.
export function normalizarRut(input) {
  const clean = String(input).replace(/[.\s]/g, '').toUpperCase();
  const m = clean.match(/^(\d{1,8})-?([\dK])$/);
  if (!m) return null;
  const [, body, dv] = m;
  let sum = 0;
  let mul = 2;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += Number(body[i]) * mul;
    mul = mul === 7 ? 2 : mul + 1;
  }
  const r = 11 - (sum % 11);
  const expected = r === 11 ? '0' : r === 10 ? 'K' : String(r);
  return expected === dv ? `${Number(body)}-${dv}` : null;
}
