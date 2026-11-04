# Job worker container. Build from the repository root:
#   docker build -f services/worker/Dockerfile -t loopfield-worker .
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY services/worker/package.json services/worker/
RUN npm ci --workspace @loopfield/worker --include-workspace-root --omit=dev --ignore-scripts
COPY packages/core packages/core
COPY supabase/functions/_shared supabase/functions/_shared
COPY services/worker services/worker
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:8080').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--import", "tsx", "services/worker/src/main.ts"]
