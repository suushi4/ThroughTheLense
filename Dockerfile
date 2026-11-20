# ThroughTheLense: Go API + web/ in one image. Works on Fly.io and with docker compose.
FROM golang:1.23-alpine AS build
WORKDIR /src
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
ARG VERSION=dev
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w -X main.version=${VERSION}" -o /out/server ./cmd/server

# distroless/static runs as root so it can write to Fly volumes, which mount root-owned.
FROM gcr.io/distroless/static-debian12
WORKDIR /app
COPY --from=build /out/server /app/server
COPY web/ /app/web/
ENV PORT=8080 DATA_DIR=/data WEB_DIR=/app/web
VOLUME /data
EXPOSE 8080
ENTRYPOINT ["/app/server"]
