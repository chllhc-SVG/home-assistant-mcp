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
WORKDIR /app/apps/log-platform
RUN pnpm build

FROM nginx:1.27-alpine
COPY apps/log-platform/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/log-platform/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
