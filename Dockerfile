# Build the TypeScript packages (a pnpm workspace) with current Node
FROM node:22-bookworm AS packages
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml /app/
COPY tables/package.json /app/tables/
COPY swarmsim-ts/package.json /app/swarmsim-ts/
COPY engine/package.json /app/engine/
COPY mockup/package.json /app/mockup/
RUN pnpm install --frozen-lockfile
# `.dockerignore` is important to cache this copy properly
COPY . /app/
RUN pnpm test:packages

# Build the old AngularJS site (swarmsim-coffee) with its old toolchain
FROM node:16-bullseye AS build

# ugly ruby stuff; this thing is ancient
# https://github.com/rvm/ubuntu_rvm
# https://askubuntu.com/questions/1480616/adding-opencpn-repository-attributeerror-nonetype-object-has-no-attribute
ENV PATH $PATH:/usr/local/rvm/bin
RUN curl -sSL https://get.rvm.io | bash &&\
    . /etc/profile.d/rvm.sh &&\
    rvm --version
WORKDIR /app
COPY .devcontainer/setup/rvm.sh /app/.devcontainer/setup/rvm.sh
# https://github.com/rvm/rvm/issues/4975#issuecomment-1477478096
RUN ln -s /bin/mkdir /usr/bin/mkdir
# RUN .devcontainer/setup/rvm.sh && ruby --version
RUN .devcontainer/setup/rvm.sh
# ENV PATH $PATH:/usr/local/rvm/environments/ruby-2.5.9
RUN . /usr/local/rvm/environments/default && ruby --version && compass --version

# the root package.json names pnpm; let Yarn 1 run anyway
ENV SKIP_YARN_COREPACK_CHECK=1
# swarmsim-coffee only needs the built output of these two packages
COPY --from=packages /app/tables/package.json /app/tables/
COPY --from=packages /app/tables/dist /app/tables/dist
COPY --from=packages /app/swarmsim-ts/package.json /app/swarmsim-ts/
COPY --from=packages /app/swarmsim-ts/dist /app/swarmsim-ts/dist
COPY package.json /app/
COPY scripts/legacy-install.sh /app/scripts/
COPY swarmsim-coffee/package.json swarmsim-coffee/yarn.lock /app/swarmsim-coffee/
RUN sh scripts/legacy-install.sh

COPY swarmsim-coffee /app/swarmsim-coffee/
# docker seems upset if bower_components is a symlink, for some reason, so copy the whole thing. Works fine in the devcontainer and in CI. Ugh.
RUN (cd swarmsim-coffee && rm bower_components && cp -rp node_modules/@bower_components bower_components)
# openssl_conf: this fixes tests and build. https://github.com/bazelbuild/rules_closure/issues/351#issuecomment-854628326 . Ugh.
RUN . /usr/local/rvm/environments/default && cd swarmsim-coffee && OPENSSL_CONF=/dev/null yarn test
# `yarn build:docker` skips the application-level ssl redirect. docker doesn't want that!
RUN . /usr/local/rvm/environments/default && cd swarmsim-coffee && OPENSSL_CONF=/dev/null yarn build:docker && cp -rp dist /app/dist

# Run the static site we just built. No Caddyfile or other config, just static files.
# "The default config file simply serves files from /usr/share/caddy" - https://hub.docker.com/_/caddy
FROM caddy:2.8
COPY --from=build /app/dist/ /usr/share/caddy
