import http from 'node:http';
import { externalLink } from './gateway.mjs';

const url = externalLink(process.argv.at(-1));
if (!url || !process.env.CUBE_DESKTOP_LINK_SOCKET) process.exit(1);
const request = http.request({ socketPath: process.env.CUBE_DESKTOP_LINK_SOCKET, path: '/open', method: 'POST', headers: { 'Content-Type': 'application/json' } }, response => {
  response.resume();
  response.once('end', () => process.exit(response.statusCode === 204 ? 0 : 1));
});
request.on('error', () => process.exit(1));
request.setTimeout(3000, () => { request.destroy(); process.exit(1); });
request.end(JSON.stringify({ url }));
