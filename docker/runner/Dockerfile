FROM node:22-bookworm-slim

RUN groupadd -r celld && useradd -r -g celld -u 1000 celld \
  && mkdir -p /workspace /opt/celld \
  && chown -R celld:celld /workspace /opt/celld

WORKDIR /opt/celld

COPY dist/runner/runner.mjs /opt/celld/runner.mjs
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts \
  && npm cache clean --force

USER celld
WORKDIR /workspace
ENV CELLD_WORKSPACE=/workspace
ENTRYPOINT ["node", "/opt/celld/runner.mjs"]
