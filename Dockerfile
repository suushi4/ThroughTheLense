# ThroughTheLense: built site (dist/) + Go server in one image.
# Railway builds it remotely: railway up (see railway.toml).

FROM node:22-bookworm-slim AS web
WORKDIR /src
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
# Everything the build might read (web/, scripts/, any new folder); what is
# excluded is listed in .dockerignore.
COPY . .
# Canonical links and social preview URLs point at this origin. Railway passes
# a service variable into the build only when it is declared as an ARG.
ARG SITE_ORIGIN=
# A failing build or check stops the image here, so Railway keeps serving the
# previous deployment instead of a broken site.
RUN SITE_ORIGIN="$SITE_ORIGIN" npm run build && node scripts/check-dist.mjs dist

FROM golang:1.27-alpine AS server
WORKDIR /src
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/server ./cmd/server

# distroless/static (not :nonroot) runs as root so it can write to the volume,
# which Railway mounts owned by root.
FROM gcr.io/distroless/static-debian12
COPY --from=server /out/server /app/server
COPY --from=web /src/dist /app/dist
# Railway sets PORT; HOST makes the server listen on every interface.
ENV HOST=0.0.0.0 PORT=8080 DATA_DIR=/data WEB_DIR=/app/dist
EXPOSE 8080
ENTRYPOINT ["/app/server"]
