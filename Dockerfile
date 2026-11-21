# ThroughTheLense: built site (dist/) + Go server in one image.
# Fly.io builds it remotely: flyctl deploy (see fly.toml).

FROM node:22-bookworm-slim AS web
WORKDIR /src
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY scripts/ scripts/
COPY web/ web/
# Canonical links, sitemap and social preview URLs point at this origin.
ARG SITE_ORIGIN=
RUN SITE_ORIGIN="$SITE_ORIGIN" npm run build

FROM golang:1.27-alpine AS server
WORKDIR /src
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/server ./cmd/server

# distroless/static runs as root so it can write to Fly volumes, which mount root-owned.
FROM gcr.io/distroless/static-debian12
COPY --from=server /out/server /app/server
COPY --from=web /src/dist /app/dist
ENV PORT=8080 DATA_DIR=/data WEB_DIR=/app/dist
VOLUME /data
EXPOSE 8080
ENTRYPOINT ["/app/server"]
