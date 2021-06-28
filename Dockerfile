FROM node:10
# Create app directory
WORKDIR /home/simple-arbitrage
COPY package*.json ./
RUN npm install
ENV ETHEREUM_RPC_URL=[YOUR_ETHEREUM_RPC_URL]
ENV PRIVATE_KEY=[YOUR_PRIVATE_KEY]
ENV BUNDLE_EXECUTOR_ADDRESS=[YOUR_BUNDLE_EXECUTOR]
COPY . .
# CMD ["/bin/sh"]
CMD ["npm","run","start"]
