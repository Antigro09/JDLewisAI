# Multi-stage build for a self-contained container image (ECS Fargate / any
# Docker host). Requires next.config.mjs `output: "standalone"`.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Dummy build-time env so `next build` succeeds without real secrets; the
# runtime container gets the real values injected (ECS task def / --env-file).
ENV DATABASE_URL="postgresql://user:pass@localhost:5432/db" \
    DIRECT_URL="postgresql://user:pass@localhost:5432/db" \
    AUTH_SECRET="build-time-placeholder-build-time-placeholder" \
    ENCRYPTION_KEY="YnVpbGQtdGltZS1wbGFjZWhvbGRlci1rZXktMzJi" \
    ANTHROPIC_API_KEY="sk-ant-build-placeholder"
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public
USER nextjs
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
CMD ["node", "server.js"]
