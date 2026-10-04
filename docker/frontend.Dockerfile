ARG WORKSPACE
ARG VITE_APP_MODE
ARG VITE_VENUE_ID=10000000-0000-4000-8000-000000000001
FROM node:22-alpine AS build
ARG WORKSPACE
ARG VITE_APP_MODE
ARG VITE_VENUE_ID
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/customer-website/package.json apps/web/customer-website/package.json
COPY apps/web/admin-console/package.json apps/web/admin-console/package.json
COPY apps/api/prisma apps/api/prisma
RUN npm ci
COPY apps/web/customer-website apps/web/customer-website
COPY apps/web/admin-console apps/web/admin-console
COPY shared shared
ENV VITE_VENUE_ID=$VITE_VENUE_ID
ENV VITE_APP_MODE=$VITE_APP_MODE
RUN npm run build --workspace=$WORKSPACE

FROM nginx:1.27-alpine
COPY docker/nginx-spa.conf /etc/nginx/conf.d/default.conf
ARG WORKSPACE
COPY --from=build /app/${WORKSPACE}/dist /usr/share/nginx/html
EXPOSE 80
