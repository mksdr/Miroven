FROM node:24.22.1-bookworm-slim AS build
WORKDIR /source/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web ./
ARG NEXT_PUBLIC_MIROVEN_API_URL=/api/v1
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_WEBSITE_URL
ENV NEXT_PUBLIC_MIROVEN_API_URL=$NEXT_PUBLIC_MIROVEN_API_URL
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_WEBSITE_URL=$NEXT_PUBLIC_WEBSITE_URL
RUN npm run build && node scripts/nginx-headers.mjs

FROM nginx:1.31-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /source/web/out /usr/share/nginx/html
COPY --from=build /source/web/out/.nginx-headers /etc/nginx/miroven-headers.conf
EXPOSE 80
