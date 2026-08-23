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
COPY apps/customer-website/package.json apps/customer-website/package.json
COPY apps/admin-console/package.json apps/admin-console/package.json
COPY apps/window-display/package.json apps/window-display/package.json
COPY apps/api/prisma apps/api/prisma
RUN npm ci
COPY apps/customer-website apps/customer-website
COPY apps/admin-console apps/admin-console
COPY apps/window-display apps/window-display
COPY shared shared
ENV VITE_VENUE_ID=$VITE_VENUE_ID
ENV VITE_APP_MODE=$VITE_APP_MODE
RUN npm run build --workspace=$WORKSPACE

FROM nginx:1.27-alpine
COPY docker/nginx-spa.conf /etc/nginx/conf.d/default.conf
ARG WORKSPACE
COPY --from=build /app/${WORKSPACE}/dist /usr/share/nginx/html
EXPOSE 80
