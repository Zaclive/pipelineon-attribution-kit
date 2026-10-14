FROM node:24.14.0-bookworm-slim
WORKDIR /app
COPY --chown=node:node package.json LICENSE ./
COPY --chown=node:node core ./core
COPY --chown=node:node server ./server
COPY --chown=node:node public ./public
RUN mkdir /app/data && chown node:node /app/data
USER node
ENV HOST=0.0.0.0 PORT=4310
EXPOSE 4310
CMD ["node", "server/start.mjs"]
