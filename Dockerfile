# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# Die Attrappen-URL gilt NUR fuer diesen Befehl, nicht als ENV im Abbild: der
# SvelteKit-Bau laedt beim Analysieren der Routen die Servermodule, und
# $lib/server/db baut seine Verbindungszeichenfolge beim Import zusammen (url.ts).
# Verbunden wird beim Bauen nie. Als ENV gesetzt koennte sie im Betrieb ein fehlendes
# Passwort verdecken — genau das, was diese Haertung verhindern soll.
RUN DATABASE_URL=postgres://build:build@127.0.0.1:1/build-attrappe \
    npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# tesseract-ocr + deutsches Sprachpaket: liest Bon-Text lokal im bon-worker-Container,
# damit das Bonfoto den Server nicht verlassen muss (Betreiber-Vorgabe, siehe
# docs/superpowers/specs/2026-09-15-bon-app-lokale-auslesung-design.md, E1). Das Abbild
# wird von bon-web, bon-worker und bon-matrix geteilt — nur bon-worker ruft Tesseract
# tatsächlich auf, aber ein gemeinsames Abbild ist einfacher zu pflegen als drei.
RUN apt-get update && apt-get install -y --no-install-recommends tini tesseract-ocr tesseract-ocr-deu \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/build ./build
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/drizzle ./drizzle
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
ENTRYPOINT ["/usr/bin/tini", "--", "docker-entrypoint.sh"]
