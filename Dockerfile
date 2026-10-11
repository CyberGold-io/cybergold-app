# syntax=docker/dockerfile:1.7

FROM node:26.10.0-bookworm-slim@sha256:662933cf47f013bc8e4beb31a6116448427a82057ba7c42c97e4c5ba766504c2 AS dependencies

WORKDIR /app

RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
        g++ \
        make \
        python3 \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./

RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund


FROM node:26.10.0-bookworm-slim@sha256:662933cf47f013bc8e4beb31a6116448427a82057ba7c42c97e4c5ba766504c2 AS builder

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1 \
    NODE_OPTIONS=--max-old-space-size=1280

COPY --from=dependencies /app/node_modules ./node_modules
COPY . .

# Public profile values are required while Next.js compiles the browser bundle.
# The secret mount is ephemeral: it is never copied into a committed image layer.
# Deployment orchestration performs live RPC validation before entering this
# isolated build; the build repeats the profile's static validation here.
ARG CYBERGOLD_APP_COMMIT
ARG CYBERGOLD_PUBLIC_ENV_SHA256
ENV NEXT_PUBLIC_CYBERGOLD_APP_COMMIT=${CYBERGOLD_APP_COMMIT}
RUN --mount=type=secret,id=app_public_env,target=/app/.env.production,required=true \
    test -n "${CYBERGOLD_PUBLIC_ENV_SHA256}" \
    && SKIP_RPC_VALIDATION=1 node scripts/validate-active-env.mjs /app/.env.production \
    && npm run build \
    && find .next/standalone -type f \
        \( -name '.env' -o -name '.env.*' -o -name '*.env' \) -delete

RUN test -z "$(find .next/standalone -type f \
    \( -name '.env' -o -name '.env.*' -o -name '*.env' \) -print -quit)"


FROM node:26.10.0-bookworm-slim@sha256:662933cf47f013bc8e4beb31a6116448427a82057ba7c42c97e4c5ba766504c2 AS development

WORKDIR /app

ENV NODE_ENV=development \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000

COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node . .

ARG CYBERGOLD_APP_COMMIT
ARG CYBERGOLD_PUBLIC_ENV_SHA256
ENV NEXT_PUBLIC_CYBERGOLD_APP_COMMIT=${CYBERGOLD_APP_COMMIT}
RUN --mount=type=secret,id=app_public_env,target=/tmp/app-public.env,required=true \
    test -n "${CYBERGOLD_PUBLIC_ENV_SHA256}" \
    && SKIP_RPC_VALIDATION=1 node scripts/validate-active-env.mjs /tmp/app-public.env \
    && chown node:node /app

# Next writes its development compilation cache and generated type files.
USER node

EXPOSE 3000

STOPSIGNAL SIGTERM

LABEL io.cybergold.app.read-client="fixed-api" \
    io.cybergold.app.configuration="backend"

CMD ["sh", "-c", "exec node node_modules/next/dist/bin/next dev --webpack --hostname \"$HOSTNAME\" --port \"$PORT\""]


FROM node:26.10.0-bookworm-slim@sha256:662933cf47f013bc8e4beb31a6116448427a82057ba7c42c97e4c5ba766504c2 AS runner

WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000

COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static

USER node

EXPOSE 3000

STOPSIGNAL SIGTERM

LABEL io.cybergold.app.read-client="fixed-api" \
    io.cybergold.app.configuration="backend"

CMD ["node", "server.js"]
