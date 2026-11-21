# Phần mềm Quản lý kho - ảnh Docker để chạy trên máy chủ (VPS, Render, Railway, Fly.io...)
FROM node:22-slim
ENV NODE_ENV=production TZ=Asia/Ho_Chi_Minh \
    DATA_DIR=/data HOST=0.0.0.0 PORT=3000
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server.js ./
COPY src ./src
COPY public ./public
# Dữ liệu (CSDL + PDF đính kèm) nằm trong /data: phải gắn ổ lưu trữ bền vững vào đây
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--no-warnings", "server.js"]
