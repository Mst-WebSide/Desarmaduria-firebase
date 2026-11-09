# Imagen del backend (se despliega en Render, plan gratis). El frontend
# (public/) también se sirve desde este mismo servidor Node (ver server.js)
# — no es una imagen separada.
FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

# Render inyecta su propia variable PORT al correr el contenedor (por
# defecto 10000) — este valor es solo el que se usa si se corre la imagen
# localmente sin definir PORT. server.js ya lee process.env.PORT (ver
# server.js, cerca de la línea 46).
ENV PORT=10000
EXPOSE 10000

CMD ["node", "index.js"]
