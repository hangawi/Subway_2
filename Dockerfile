# 써브웨이 서버 (SOPHIA Dockerfile 방식: 만드는 단계에서 검사 → 실행 단계는 결과물만, root 아닌 사용자)
ARG NODE_IMAGE=node:22-alpine
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY . .
# 타입 검사 + 구조 검사 + 전체 시험 + 묶기. 하나라도 실패하면 이미지가 안 만들어진다
RUN npm run verify

FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
ARG SUBWAY_BUILD_COMMIT=UNCOMMITTED
ARG SUBWAY_BUILT_AT=unknown
ENV NODE_ENV=production SUBWAY_HOST=0.0.0.0 SUBWAY_PORT=4174 SUBWAY_ROOT=/app \
    SUBWAY_CATALOG_PATH=/app/catalog/subway-catalog.json SUBWAY_QUOTA_DIR=/app/var/quota \
    SUBWAY_BUILD_COMMIT=${SUBWAY_BUILD_COMMIT} SUBWAY_BUILT_AT=${SUBWAY_BUILT_AT}
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/catalog/subway-catalog.json ./catalog/subway-catalog.json
COPY --from=build /app/vendor/sophia/SOURCE_COMMIT ./vendor/sophia/SOURCE_COMMIT
RUN addgroup -S subway && adduser -S -G subway -H subway && mkdir -p /app/var/quota && chown -R subway:subway /app/var
USER subway
EXPOSE 4174
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:4174/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","dist/main.mjs"]
