# Generic container image (Fly.io, Koyeb, Google Cloud Run, any Docker host).
FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY . .
ENV HOST=0.0.0.0 PORT=3210 KENUXA_PLATFORM=container
EXPOSE 3210
CMD ["node", "--env-file-if-exists=.env", "--env-file-if-exists=.env.local", "server.mjs"]
