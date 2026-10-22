FROM docker.io/oven/bun:1.4.4-slim
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY src ./src
USER bun
EXPOSE 8080
CMD ["bun", "run", "src/main.ts"]
