FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PORT=3000

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ffmpeg \
    python3 \
    python3-pip \
    ca-certificates \
  && pip3 install --break-system-packages yt-dlp edge-tts \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY app.js config.js index.html voanh.html voanh-video-studio.js sulphur.html sulphur-studio.js styles.css favicon.png privacy.html terms.html tiktok-callback.html ./
COPY server ./server
COPY scripts ./scripts
COPY storage ./storage

RUN mkdir -p storage/uploads storage/jobs storage/secrets storage/sulphur/clips storage/sulphur/bulk storage/sulphur/long

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
