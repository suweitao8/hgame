import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createHGameNetworkServer } from '../dist/create-server.js';

const script = fileURLToPath(new URL('./lockstep-soak.mjs', import.meta.url));

async function freePort() {
  const reservation = net.createServer().listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
  return port;
}

test('lockstep soak joins from independent processes and compares full frames after reconnect', { timeout: 30_000 }, async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'hgame-lockstep-soak-'));
  const server = createHGameNetworkServer();
  const children = [];
  const port = await freePort();
  function start(args, onLine) {
    const child = spawn(process.execPath, [script, ...args], {
      windowsHide: true,
      timeout: 22_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const done = once(child, 'close');
    children.push({ child, done });
    let stdout = '';
    let stderr = '';
    let offset = 0;
    child.stdout.setEncoding('utf8').on('data', chunk => {
      stdout += chunk;
      let next;
      while ((next = stdout.indexOf('\n', offset)) !== -1) {
        onLine?.(stdout.slice(offset, next));
        offset = next + 1;
      }
    });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    return done.then(([status]) => ({ status, stdout, stderr }));
  }

  try {
    await server.listen(port, '127.0.0.1');
    const endpoint = 'http://127.0.0.1:' + port;
    const hostPath = path.join(temporary, 'host.json');
    const peerPath = path.join(temporary, 'peer.json');
    const room = Promise.withResolvers();
    const common = ['--endpoint', endpoint, '--seconds', '10'];
    const host = start([...common, '--role', 'host', '--out', hostPath], line => {
      if (!line.startsWith('{')) return;
      const data = JSON.parse(line);
      if (data.event === 'room') room.resolve(data.roomId);
    });
    const roomId = await Promise.race([room.promise, host.then(result => {
      throw new Error('host exited before announcing a room: ' + result.stderr);
    })]);
    const peer = start([...common, '--role', 'peer', '--room', roomId, '--drop-after', '4', '--out', peerPath]);
    const [hostResult, peerResult] = await Promise.all([host, peer]);
    assert.equal(hostResult.status, 0, hostResult.stderr || hostResult.stdout);
    assert.equal(peerResult.status, 0, peerResult.stderr || peerResult.stdout);
    const peerReport = JSON.parse(await readFile(peerPath, 'utf8'));
    const hostReport = JSON.parse(await readFile(hostPath, 'utf8'));
    assert.equal(peerReport.reconnects.length, 1);
    assert.equal(peerReport.reconnects[0].injected, true);
    assert.ok(peerReport.reconnects[0].replayedFrames > 0);
    assert.ok(peerReport.reconnects[0].recoveredMs > 0);
    const check = await start(['--compare', hostPath, '--with', peerPath]);
    assert.equal(check.status, 0, check.stderr);
    assert.ok(JSON.parse(check.stdout).commonFrames >= 160);

    const otherPath = path.join(temporary, 'other.json');
    const matching = peerReport.blocks.find(block => hostReport.blocks.some(other => other.firstTick === block.firstTick));
    matching.hash = (matching.hash.startsWith('a') ? 'b' : 'a') + matching.hash.slice(1);
    await writeFile(otherPath, JSON.stringify(peerReport));
    const failed = await start(['--compare', hostPath, '--with', otherPath]);
    assert.equal(failed.status, 1);
    assert.match(failed.stderr, /confirmed frames differ/i);
  } finally {
    for (const { child } of children) if (child.exitCode === null && child.signalCode === null) child.kill();
    await Promise.allSettled(children.map(({ done }) => done));
    await server.gracefullyShutdown(false);
    await rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('standalone lockstep soak times out when the endpoint never answers', { timeout: 7_000 }, async () => {
  const sockets = new Set();
  const errors = [];
  let connections = 0;
  const stalled = net.createServer(socket => {
    connections++;
    sockets.add(socket);
    socket.on('error', error => { if (error.code !== 'ECONNRESET') errors.push(error.message); });
    socket.once('close', () => sockets.delete(socket));
    socket.resume();
  }).listen(0, '127.0.0.1');
  await once(stalled, 'listening');
  let child;
  try {
    const endpoint = 'http://127.0.0.1:' + stalled.address().port;
    child = spawn(process.execPath, [script, '--endpoint', endpoint, '--role', 'host', '--connect-timeout', '1'], {
      windowsHide: true, timeout: 5_000, stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    const [status] = await once(child, 'close');
    assert.equal(status, 1, stderr);
    assert.match(stderr, /Timed out while connecting/);
    assert.ok(connections > 0, 'The endpoint received a connection');
    assert.deepEqual(errors, []);
  } finally {
    if (child?.exitCode === null && child.signalCode === null) child.kill();
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => stalled.close(resolve));
  }
});
