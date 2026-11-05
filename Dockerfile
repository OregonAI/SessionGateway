# The SessionGateway image (ticket #25, ADR-0007): the code and the pinned embedding model, and nothing else.
# The database is not in it. It lives on the deploy box's volume, mounted at /data, and is stamped with this
# image's schema version (src/packages/database, ADR-0048). The same image runs both entry scripts:
#
#   docker build -t oregonai/session-gateway:current <clone>     (what platform-deploy's deploy.sh runs)
#   node src/bin/server.ts   the MCP server       (command of the compose service session-gateway)
#   node src/bin/ingest.ts   the ingest worker    (command of session-gateway-ingest, off for now)
#
# Both are run from the WORKDIR, /app, as Node 26 runs .ts directly (type stripping: no build step).
# Pinned by digest, as node:26.13.0-bookworm-slim: Debian, because onnxruntime-node ships glibc binaries.
# package.json's engines say >=26.13.0 <27. The image is named in each FROM, not through an ARG, because dependabot
# reads FROM lines: a bump of the tag and digest arrives as a pull request.
# --- Stage 1: production dependencies. -------------------------------------------------------------------
# `npm ci --omit=dev`: the entry scripts need no dev dependency (no compiler, no test runner). .npmrc is
# copied so the repository's own policy applies: strict-allow-scripts with onnxruntime-node denied
# (ADR-0026: its install script only downloads CUDA libraries from NuGet, and the CPU runtime is in the package).
FROM node:26.13.0-bookworm-slim@sha256:bc0a2afd3b74ce12222fc8bab99271e66257f021078f5f4a5d687a77d280c1d9 AS dependencies
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev --no-audit --no-fund \
 # The CPU runtime for this platform is all the image uses: leave out the other three (ADR-0026, 86+134+25 MB).
 && cd node_modules/onnxruntime-node/bin/napi-v6 \
 && rm -rf darwin win32 linux/arm64 \
 && test -f linux/x64/libonnxruntime.so.1

# --- Stage 2: the pinned embedding model. ----------------------------------------------------------------
# Only the files the two model scripts read are copied in, so a change to the code does not download the
# model again. fetch.ts checks each file against the lock's size and sha256 and fails naming the file; verify.ts
# then checks again, offline. The server and the worker check the same lock at every start-up.
FROM node:26.13.0-bookworm-slim@sha256:bc0a2afd3b74ce12222fc8bab99271e66257f021078f5f4a5d687a77d280c1d9 AS model
WORKDIR /app
ENV MODEL_PATH=/app/model
COPY package.json ./
COPY scripts/model ./scripts/model
COPY src/packages/embedder/lock.ts ./src/packages/embedder/lock.ts
COPY src/packages/embedder/data ./src/packages/embedder/data
RUN node scripts/model/fetch.ts \
 && node scripts/model/verify.ts \
 # The container runs as uid 1000 (compose's user), which need not own these files.
 && chmod -R a+rX /app/model

# --- Stage 3: the image. ----------------------------------------------------------------------------------
FROM node:26.13.0-bookworm-slim@sha256:bc0a2afd3b74ce12222fc8bab99271e66257f021078f5f4a5d687a77d280c1d9
WORKDIR /app
ENV NODE_ENV=production \
    MODEL_PATH=/app/model
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=model /app/model ./model
COPY package.json ./
COPY src ./src
# The node image's own user is uid 1000; compose sets the same uid for the deploy box's volume files.
USER 1000:1000
EXPOSE 8000
CMD ["node", "src/bin/server.ts"]
