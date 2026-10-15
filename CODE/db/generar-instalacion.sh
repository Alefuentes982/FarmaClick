#!/bin/sh
# Regenera db/instalacion_completa.sql = esquema base + migraciones en orden. Ejecutar desde la carpeta db/.
cd "$(dirname "$0")" || exit 1
{
  printf -- '-- =====================================================================\n-- FarmaClick — instalación completa (GENERADO: no editar a mano)\n-- = farmaclick_postgresql_completo.sql + migraciones, en orden. Para crear una base nueva de una sola vez\n-- (editor SQL de Supabase). Después: ALTER ROLE app_backend LOGIN PASSWORD '"'"'<secreto>'"'"';\n-- Regenerar: db/generar-instalacion.sh\n-- =====================================================================\n\n'
  cat farmaclick_postgresql_completo.sql
  for f in migraciones/*.sql; do printf '\n'; cat "$f"; done
} > instalacion_completa.sql
