import basicSsl from '@vitejs/plugin-basic-ssl';

export default {
  base: '/deckspace/',
  plugins: [basicSsl()],
  server: { host: true },
};
