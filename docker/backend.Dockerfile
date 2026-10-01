FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/customer-website/package.json apps/web/customer-website/package.json
COPY apps/web/admin-console/package.json apps/web/admin-console/package.json
COPY apps/window-display/package.json apps/window-display/package.json
COPY apps/api/prisma apps/api/prisma
RUN npm ci
COPY apps/api apps/api
COPY shared shared
RUN npm run build --workspace=apps/api

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/apps/api apps/api
COPY --from=build /app/shared shared
COPY docker/start-backend.mjs docker/start-backend.mjs
EXPOSE 3000
CMD ["npm", "run", "start:prod", "--workspace=apps/api"]
