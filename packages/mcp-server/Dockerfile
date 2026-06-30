FROM node:20-alpine AS build
WORKDIR /app

RUN corepack enable

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* .npmrc* ./
COPY apps/log-platform/package.json apps/log-platform/package.json
COPY packages/mcp-server/package.json packages/mcp-server/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json
COPY packages/shared-utils/package.json packages/shared-utils/package.json
COPY packages/shared-schema/package.json packages/shared-schema/package.json

RUN pnpm install --frozen-lockfile=false

COPY . .
WORKDIR /app/packages/mcp-server
RUN pnpm build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/mcp-server/node_modules ./packages/mcp-server/node_modules
COPY --from=build /app/packages/mcp-server/dist ./packages/mcp-server/dist
COPY --from=build /app/packages/mcp-server/package.json ./packages/mcp-server/package.json
COPY config ./config
WORKDIR /app/packages/mcp-server
EXPOSE 4000
CMD ["node", "dist/main.js"]
