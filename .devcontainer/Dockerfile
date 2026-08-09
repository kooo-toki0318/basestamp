FROM ghcr.io/foundry-rs/foundry:v1.7.1@sha256:8347b728d5d393dac1c018691b36f506d23b9dcd78341d40ea0fcb11c3a19cdd AS foundry

FROM mcr.microsoft.com/devcontainers/javascript-node:5.0.2-24-bookworm@sha256:7f9160225f2e0af7a3531a925358ffebff77e1d03d1628953e4252efd6e7bf2d

USER root

ENV COREPACK_HOME=/opt/corepack
ENV PNPM_HOME=/home/node/.local/share/pnpm
ENV CODEX_HOME=/home/node/.codex
ENV PATH=/home/node/.local/share/pnpm:${PATH}

COPY --from=foundry --chown=root:root --chmod=0755 \
    /usr/local/bin/forge \
    /usr/local/bin/cast \
    /usr/local/bin/anvil \
    /usr/local/bin/chisel \
    /usr/local/bin/

RUN mkdir -p \
        /opt/corepack \
        /home/node/.local/share/pnpm/store \
        /home/node/.foundry/keystores \
        /home/node/.codex \
    && corepack enable --install-directory /home/node/.local/share/pnpm \
    && corepack enable --install-directory /usr/local/share/npm-global/bin \
    && corepack install --global pnpm@11.4.0+sha512.f0febc7e37552ab485494a914241b338e0b3580b93d54ce31f00933015880863129038a1b4ae4e414a0ee63ac35bf21197e990172c4a68256450b5636310968f \
    && npm install --global --ignore-scripts --no-audit --no-fund @openai/codex@0.146.0 \
    && chown -R node:node \
        /home/node/.local \
        /home/node/.foundry \
        /home/node/.codex

COPY --chown=node:node --chmod=0600 \
    .devcontainer/codex-container-config.toml \
    /home/node/.codex/config.toml

ENV COREPACK_DEFAULT_TO_LATEST=0
ENV COREPACK_ENABLE_NETWORK=0

USER node
WORKDIR /workspaces/base-stamp
