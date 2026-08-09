FROM debian:bullseye as builder

ARG NODE_VERSION=24.19.0
ARG PNPM_VERSION=9.13.2

RUN apt-get update; apt install -y curl
RUN curl https://get.volta.sh | bash
ENV VOLTA_HOME /root/.volta
ENV PATH /root/.volta/bin:$PATH
RUN volta install node@${NODE_VERSION} pnpm@${PNPM_VERSION}

#######################################################################

RUN mkdir /app
WORKDIR /app

# pnpm does not install devDependencies when NODE_ENV=production, so we
# install with --prod=false first, then build, then prune devDependencies.
# Ref: https://pnpm.io/cli/install#--prod--p

COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @chatme/client build

ENV NODE_ENV production
RUN pnpm install --frozen-lockfile --prod --filter @chatme/server
FROM debian:bullseye

LABEL fly_launch_runtime="nodejs"

COPY --from=builder /root/.volta /root/.volta
COPY --from=builder /app /app

WORKDIR /app
ENV NODE_ENV production
ENV PATH /root/.volta/bin:$PATH

CMD [ "pnpm", "run", "start" ]
