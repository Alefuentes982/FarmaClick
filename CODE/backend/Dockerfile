# API de FarmaClick (Node.js + Express). La CI la construye para linux/amd64 (VM x86_64 de Oracle Cloud); ver ci.yml.
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY scripts/crear-admin.js ./scripts/crear-admin.js
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "src/server.js"]
