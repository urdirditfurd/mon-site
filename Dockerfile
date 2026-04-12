FROM node:20-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

# Runtime dependencies required by the pipeline:
# - ffmpeg/ffprobe for video processing
# - python + yt-dlp for YouTube ingestion
# - edge-tts for French dubbing
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg python3 python3-pip ca-certificates \
  && pip3 install --no-cache-dir yt-dlp edge-tts \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

# Ensure writable folders exist in container.
RUN mkdir -p storage/uploads storage/jobs storage/secrets

EXPOSE 3000
CMD ["npm", "start"]
