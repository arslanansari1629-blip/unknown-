import { handleRelay } from './_relay.js';

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  return handleRelay(req, res);
}
