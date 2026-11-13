import { createHGameNetworkServer } from './create-server.js';

const port = Number(process.env.PORT ?? 2567);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new RangeError('PORT must be between 0 and 65535');
const host = process.env.HOST ?? '127.0.0.1';

const server = createHGameNetworkServer({ enableLabRooms: process.env.NODE_ENV !== 'production' });
await server.listen(port, host);
console.log(`[HGame Network] Colyseus 0.18 listening on ${host}:${port}`);
console.log(`[HGame Network] Lab rooms: ${process.env.NODE_ENV === 'production' ? 'disabled' : 'enabled'}`);
