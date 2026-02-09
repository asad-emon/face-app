FROM node:20-slim

WORKDIR /home/node/app

COPY --chown=node:node ./api/package.json ./api/package-lock.json* ./
RUN npm install --omit=dev

COPY --chown=node:node ./api ./

USER node

EXPOSE 8080

CMD ["npm", "start"]
