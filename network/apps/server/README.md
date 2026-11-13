# HGame Network Server

The deployed server is a single Node.js 22 process using Colyseus Core 0.18 and the WebSocket transport. It is an in-memory service: rooms, player slots, input buffers and hash reports exist only for the lifetime of the process.

## Development

From the workspace root:

```powershell
npm run dev:server
```

This registers `lab_state_sync`, `lab_predicted` and `lab_lockstep`. They are conformance fixtures, not game rooms.

## Production room registration

Game projects register their own Room classes while reusing the shared transport:

```ts
import { createHGameNetworkServer } from '@hgame/network-server';
import { NinjaRoom } from './rooms/NinjaRoom.js';
import { CardRoom } from './rooms/CardRoom.js';

const server = createHGameNetworkServer({
  enableLabRooms: false,
  gameRooms: {
    game_ninja: NinjaRoom,
    game_cards: CardRoom,
  },
});

await server.listen(Number(process.env.PORT ?? 2567), process.env.HOST ?? '0.0.0.0');
```

Each game Room owns its schema, commands, simulation and disconnect policy. The room type name is a matchmaking key; pass `gameId` and other game configuration through the room creation options. Colyseus built-in `joinOrCreate`, `create` and `joinById` provide room allocation. Ranked queues, team balancing, platform authentication, bot assignment, database persistence and multi-process presence are separate future adapters.

Do not expose the `lab_*` room types in production. Add origin allowlists, platform identity verification, rate limits and observability before public deployment.
