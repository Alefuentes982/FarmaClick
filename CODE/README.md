# FarmaClick

Sistema de gestión para farmacias: abastecimiento, inventario, venta presencial con cuadratura de caja y reportes.

| Capa | Tecnología | Carpeta |
|---|---|---|
| API | Node.js 22 + Express | `backend/` (módulos en `src/modules/`, compartido en `src/core/`) |
| Web | React + Vite + Bootstrap, servida por Nginx | `frontend/` |
| Base de datos | PostgreSQL 16 (Supabase en dev y prod) | `db/` |
| Despliegue | Docker, GitHub Actions → GHCR → Oracle Cloud | `.github/workflows/`, `deploy/` |

## Desarrollo local
Requisitos: Docker y Git.

```bash
docker compose up
```
- Web: http://localhost:5173 · API: http://localhost:3000/api/health · PostgreSQL: `localhost:54329` (`postgres` / `postgres`, base `farmaclick`).
- Usuarios de desarrollo: `admin@farmaclick.local` / `Admin12345` y `vendedor@farmaclick.local` / `Vendedor12345`.
- Pruebas: `docker compose exec api npm test`. Base desde cero: `docker compose down -v`.
- El login local (`AUTH_MODE=local`) solo existe en desarrollo; la API no arranca con él si `NODE_ENV=production`.
- Correo opcional en local: crear `backend/.env` con las variables `SMTP_*` de `backend/.env.example`.

## Flujo de trabajo
- Ramas: `main` = producción, `develop` = dev/staging, `feature/<nombre>` = cada cambio, con Pull Request hacia `develop`.
- CI (`ci.yml`) en cada Pull Request: control de secretos, pruebas del backend, esquema + migraciones sobre PostgreSQL limpio y compilación del frontend.
- Push a `develop` / `main`: imágenes `linux/amd64` en GHCR (etiquetas `dev` / `prod`) y despliegue por SSH en la VM del entorno.
- Cambios de base de datos: migración nueva e idempotente en `db/migraciones/`, luego `db/generar-instalacion.sh`, y aplicarla en el SQL Editor de Supabase de cada entorno (el despliegue no toca la base).

## Configuración
- Plantillas: `backend/.env.example` (API) y `deploy/.env.example` (`.env` de cada VM, `chmod 600`).
- Secretos de GitHub Actions: `DEV_VM_HOST`, `DEV_VM_USER`, `DEV_VM_SSH_KEY`, `PROD_VM_HOST`, `PROD_VM_USER`, `PROD_VM_SSH_KEY`. Variables: `URL_DEV`, `URL_PROD`.
- Ningún secreto va al repositorio. `_privado/` está ignorada por Git y la CI rechaza archivos `.env` reales o credenciales.

## Contribuir
Ramas, commits, migraciones y Pull Requests: ver [`CONTRIBUTING.md`](CONTRIBUTING.md). Al abrir un Pull Request se carga la plantilla `.github/pull_request_template.md`, y `.github/CODEOWNERS` asigna a quién revisa cada parte.
