FROM node:22-bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ffmpeg \
        libchromaprint-tools \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production
ENV FFPROBE_COMMAND=ffprobe
ENV FPCALC_COMMAND=fpcalc
EXPOSE 3000
CMD ["node", "server.js"]
