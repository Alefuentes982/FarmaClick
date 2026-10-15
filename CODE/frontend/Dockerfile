# SPA de FarmaClick servida por Nginx, que además reenvía /api a la API. La CI la construye para linux/amd64 (ver ci.yml).
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# La API se llama por la misma dirección (ruta /api), así que no hace falta VITE_API_URL.
RUN npm run build

FROM nginx:1.27-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1/healthz || exit 1
