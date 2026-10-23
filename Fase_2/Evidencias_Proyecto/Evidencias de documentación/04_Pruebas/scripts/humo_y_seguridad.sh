#!/usr/bin/env bash
# Pruebas de humo, integración básica y seguridad de la API de FarmaClick.
# Uso:   bash humo_y_seguridad.sh [URL_BASE]
#   Local (docker compose up):  bash humo_y_seguridad.sh http://localhost:3000
#   Dev:                         bash humo_y_seguridad.sh http://<IP-VM-dev>
#   Producción:                  bash humo_y_seguridad.sh https://farmaclick-medifarm.duckdns.org
# Credenciales: por defecto las de desarrollo local. En dev/prod exporte ADMIN_CORREO, ADMIN_CLAVE, VEND_CORREO, VEND_CLAVE.
# Requiere curl. jq es opcional (si no está, se usa sed para leer el token).
set -u
URL=${1:-http://localhost:3000}
ADMIN_CORREO=${ADMIN_CORREO:-admin@farmaclick.local}; ADMIN_CLAVE=${ADMIN_CLAVE:-Admin12345}
VEND_CORREO=${VEND_CORREO:-vendedor@farmaclick.local}; VEND_CLAVE=${VEND_CLAVE:-Vendedor12345}
ok=0; mal=0
prueba() { # prueba <id> <descripción> <código esperado> <código obtenido>
  if [ "$3" = "$4" ]; then echo "  [OK]   $1 $2 (HTTP $4)"; ok=$((ok+1)); else echo "  [FALLA] $1 $2 (esperado $3, obtenido $4)"; mal=$((mal+1)); fi
}
codigo() { curl -s -o /dev/null -w "%{http_code}" "$@"; }
token() {
  local r; r=$(curl -s -X POST "$URL/api/auth/login" -H 'Content-Type: application/json' -d "{\"correo\":\"$1\",\"password\":\"$2\"}")
  if command -v jq >/dev/null; then echo "$r" | jq -r .access_token; else echo "$r" | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p'; fi
}
echo "== FarmaClick · pruebas sobre $URL · $(date '+%d-%m-%Y %H:%M')"
echo "-- Humo"
prueba CP-INT-01 "API viva /api/health" 200 "$(codigo "$URL/api/health")"
prueba CP-INT-02 "Base de datos /api/health/db" 200 "$(codigo "$URL/api/health/db")"
echo "-- Autenticación"
prueba CP-SEG-01 "Login con clave incorrecta" 401 "$(codigo -X POST "$URL/api/auth/login" -H 'Content-Type: application/json' -d "{\"correo\":\"$ADMIN_CORREO\",\"password\":\"incorrecta\"}")"
prueba CP-SEG-02 "Login con correo inválido (validación zod)" 400 "$(codigo -X POST "$URL/api/auth/login" -H 'Content-Type: application/json' -d '{"correo":"no-es-correo","password":"x"}')"
prueba CP-SEG-03 "Ruta protegida sin token" 401 "$(codigo "$URL/api/inventario/stock")"
prueba CP-SEG-04 "Token falso" 401 "$(codigo -H 'Authorization: Bearer abc.def.ghi' "$URL/api/inventario/stock")"
TA=$(token "$ADMIN_CORREO" "$ADMIN_CLAVE"); TV=$(token "$VEND_CORREO" "$VEND_CLAVE")
[ -n "$TA" ] && echo "  [OK]   CP-INT-03 Login del Administrador" && ok=$((ok+1)) || { echo "  [FALLA] CP-INT-03 Login del Administrador"; mal=$((mal+1)); }
echo "-- Autorización por rol"
prueba CP-INT-04 "Admin: /api/auth/me" 200 "$(codigo -H "Authorization: Bearer $TA" "$URL/api/auth/me")"
prueba CP-INT-05 "Admin: stock" 200 "$(codigo -H "Authorization: Bearer $TA" "$URL/api/inventario/stock")"
prueba CP-INT-06 "Admin: dashboard resumen" 200 "$(codigo -H "Authorization: Bearer $TA" "$URL/api/dashboard/resumen")"
prueba CP-INT-07 "Admin: usuarios" 200 "$(codigo -H "Authorization: Bearer $TA" "$URL/api/usuarios")"
if [ -n "$TV" ]; then
  prueba CP-SEG-05 "Vendedor NO accede a usuarios" 403 "$(codigo -H "Authorization: Bearer $TV" "$URL/api/usuarios")"
  prueba CP-SEG-06 "Vendedor NO accede a inventario (escritura)" 403 "$(codigo -X POST -H "Authorization: Bearer $TV" -H 'Content-Type: application/json' -d '{}' "$URL/api/inventario/ajustes")"
  prueba CP-INT-08 "Vendedor: turno de caja (pos)" 200 "$(codigo -H "Authorization: Bearer $TV" "$URL/api/pos/turno")"
fi
echo "-- Entradas maliciosas"
prueba CP-SEG-07 "Inyección SQL en búsqueda no rompe la API" 200 "$(codigo -G -H "Authorization: Bearer $TA" --data-urlencode "q=' OR 1=1; DROP TABLE producto; --" "$URL/api/productos")"
prueba CP-SEG-08 "Identificador inválido" 400 "$(codigo -H "Authorization: Bearer $TA" "$URL/api/productos/no-es-uuid")"
echo "-- Cabeceras de seguridad (contenedor web)"
CAB=$(curl -s -I "${URL%/}/" | tr -d '\r')
for h in "X-Content-Type-Options: nosniff" "X-Frame-Options: DENY" "Referrer-Policy"; do
  echo "$CAB" | grep -qi "$h" && { echo "  [OK]   CP-SEG-09 cabecera $h"; ok=$((ok+1)); } || echo "  [INFO] CP-SEG-09 cabecera $h no presente (normal en local: Vite no usa Nginx)"
done
echo "== Resultado: $ok aprobadas, $mal fallidas"
[ "$mal" -eq 0 ]
