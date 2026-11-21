import { handleCaptionsRequest } from '../server/captionsHandler.js';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '50mb',
    },
  },
};

export default async function handler(req, res) {
  return handleCaptionsRequest(req, res);
}
