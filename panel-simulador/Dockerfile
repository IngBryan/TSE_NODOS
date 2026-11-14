# syntax=docker/dockerfile:1
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
FROM deps AS builder
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build
FROM node:24-alpine AS runner
WORKDIR /app
# SSH executes kubectl on the Central node; retain the existing CLI tools in the image.
RUN apk add --no-cache openssh-client kubectl docker-cli docker-cli-compose \
 && addgroup -S -g 1001 nodejs && adduser -S -u 1001 -G nodejs nextjs \
 && mkdir -p /app/data /app/.next/cache && chown -R 1001:0 /app && chmod -R g=u /app
COPY --from=builder --chown=1001:0 /app/.next/standalone ./
COPY --from=builder --chown=1001:0 /app/.next/static ./.next/static
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3100 HOSTNAME=0.0.0.0 PANEL_STATE_DIR=/app/data
USER 1001
EXPOSE 3100
CMD ["node", "server.js"]
