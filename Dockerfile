# syntax=docker/dockerfile:1

# Publishes ghcr.io/gfargo/coco — installs the already-published git-coco
# package from npm (not a source build), so the builder stage exists to keep
# the npm cache / any transitive native-compile toolchain out of the runtime
# image rather than to build coco itself.
ARG COCO_VERSION=latest

FROM node:22-alpine AS builder
RUN apk add --no-cache python3 make g++ git
ARG COCO_VERSION
RUN npm install --global --prefix /opt/coco "git-coco@${COCO_VERSION}"

FROM node:22-alpine AS runtime
# git is required at runtime: coco shells out to it (via simple-git) for
# every core operation (commit, log, diff, blame, etc).
RUN apk add --no-cache git
COPY --from=builder /opt/coco /opt/coco
ENV PATH="/opt/coco/bin:${PATH}"

ENTRYPOINT ["coco"]
CMD ["--help"]
