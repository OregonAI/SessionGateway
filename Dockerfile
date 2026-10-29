# One image for both Google Cloud Run and Azure Container Apps.
# Build the index first:  npm run ingest -- <your.jsonl>   (writes data/session.db)

FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080 SESSION_DB=/app/data/session.db
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY data/session.db ./data/session.db
USER node
EXPOSE 8080
CMD ["node", "dist/bin/http.js"]
