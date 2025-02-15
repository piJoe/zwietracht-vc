FROM node:23

ENV NODE_ENV=production

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm ci

COPY ./dist-server .

EXPOSE 8099
EXPOSE 9000-9100/udp

CMD [ "node", "server.js"]