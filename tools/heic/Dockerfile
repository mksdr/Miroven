# syntax=docker/dockerfile:1@sha256:4edf897a3ffa55b89f906fc8cc78afdb3f1834cc9c7083565e611a8a7d5fe99e
ARG NODE_IMAGE=node:24.22.1-bookworm-slim@sha256:be8204d4bd327363357f532187b752ff62759c31bedf98e9e18fc08c9cbd605c
FROM ${NODE_IMAGE}
COPY web/vendor/heic/sources/ /inputs/
ENV EMSDK=/emsdk
ENV PATH="/emsdk:/emsdk/upstream/emscripten:${PATH}"
WORKDIR /build
ENTRYPOINT ["bash", "/recipe/build.sh"]
# One installation layer also bounds storage on vfs Docker daemons.
RUN --mount=type=secret,id=proxy_ca,mode=0444 \
    set -eu; \
    if [ -f /run/secrets/proxy_ca ]; then \
      export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; \
      export SSL_CERT_FILE=/run/secrets/proxy_ca; \
      export GIT_SSL_CAINFO=/run/secrets/proxy_ca; \
    fi; \
    printf 'deb [check-valid-until=no] https://snapshot.debian.org/archive/debian/20261101T000000Z bookworm main\ndeb [check-valid-until=no] https://snapshot.debian.org/archive/debian-security/20261101T000000Z bookworm-security main\ndeb [check-valid-until=no] https://snapshot.debian.org/archive/debian/20261101T000000Z bookworm-updates main\n' > /etc/apt/sources.list; \
    rm /etc/apt/sources.list.d/debian.sources; \
    apt-get -o Acquire::https::CaInfo="${SSL_CERT_FILE:-/etc/ssl/certs/ca-certificates.crt}" update; \
    apt-get -o Acquire::https::CaInfo="${SSL_CERT_FILE:-/etc/ssl/certs/ca-certificates.crt}" install -y --no-install-recommends python3 cmake make autoconf automake libtool pkg-config git xz-utils ca-certificates; \
    git init /emsdk; cd /emsdk; \
    git remote add origin https://github.com/emscripten-core/emsdk.git; \
    git fetch --depth=1 origin 62a853cd3b3134398ce85cde8bb5cbb2ef0194cb; \
    git checkout --detach FETCH_HEAD; \
    ./emsdk install 4.0.10; ./emsdk activate 4.0.10; \
    mkdir -p /opt/wrapper; tar -xf /inputs/heic-to.tar.gz -C /opt/wrapper; \
    cd /opt/wrapper; npm ci --no-audit --no-fund; \
    rm -rf /var/lib/apt/lists/* /root/.npm /emsdk/.git /emsdk/downloads /emsdk/node
