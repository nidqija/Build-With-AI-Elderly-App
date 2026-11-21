import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { handleCaptionsRequest } from './server/captionsHandler.js';

function captionsApiPlugin() {
  const attachMiddleware = (middlewares) => {
    middlewares.use('/api/captions', (req, res) => {
      handleCaptionsRequest(req, res);
    });
  };

  return {
    name: 'server-side-captions-api',
    configureServer(server) {
      attachMiddleware(server.middlewares);
    },
    configurePreviewServer(server) {
      attachMiddleware(server.middlewares);
    },
  };
}

export default defineConfig({
  plugins: [react(), captionsApiPlugin()],
});
