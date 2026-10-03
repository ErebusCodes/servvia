import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';

/**
 * Disposable PostgreSQL and Redis owned by one evaluation: their own data
 * directories, loopback only, random ports, torn down afterwards. Nothing the
 * candidate configures decides which server it talks to.
 */
export function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function startPostgres({ bin, dir, timezone = 'UTC' }) {
  const data = join(dir, 'pgdata');
  mkdirSync(dir, { recursive: true });
  const init = spawnSync(join(bin, 'initdb'), ['-D', data, '-U', 'evaluator', '--auth=trust', '-E', 'UTF8', '--locale=C', '--no-sync'], { encoding: 'utf8' });
  if (init.status !== 0) throw new Error(`initdb failed: ${init.stderr}`);
  const port = await freePort();
  const proc = spawn(join(bin, 'postgres'), [
    '-D', data, '-p', String(port), '-c', 'listen_addresses=127.0.0.1', '-c', 'unix_socket_directories=',
    '-c', `timezone=${timezone}`, '-c', 'fsync=off', '-c', 'synchronous_commit=off', '-c', 'full_page_writes=off',
  ], { stdio: 'ignore' });
  for (let i = 0; i < 100; i += 1) {
    const ready = spawnSync(join(bin, 'pg_isready'), ['-h', '127.0.0.1', '-p', String(port), '-U', 'evaluator'], { encoding: 'utf8' });
    if (ready.status === 0) {
      const version = spawnSync(join(bin, 'postgres'), ['--version'], { encoding: 'utf8' }).stdout.trim();
      return {
        url: (db) => `postgresql://evaluator@127.0.0.1:${port}/${db}`,
        port,
        version,
        createDatabase(name) {
          const res = spawnSync(join(bin, 'createdb'), ['-h', '127.0.0.1', '-p', String(port), '-U', 'evaluator', name], { encoding: 'utf8' });
          if (res.status !== 0) throw new Error(`createdb ${name} failed: ${res.stderr}`);
        },
        async stop() {
          proc.kill('SIGINT');
          for (let j = 0; j < 50 && proc.exitCode === null; j += 1) await sleep(100);
          if (proc.exitCode === null) proc.kill('SIGKILL');
          rmSync(dir, { recursive: true, force: true });
        },
      };
    }
    await sleep(100);
  }
  proc.kill('SIGKILL');
  throw new Error('postgres did not become ready');
}

export async function startRedis({ bin }) {
  const port = await freePort();
  const server = join(bin, 'redis-server');
  const proc = spawn(server, ['--port', String(port), '--bind', '127.0.0.1', '--save', '', '--appendonly', 'no'], { stdio: 'ignore' });
  for (let i = 0; i < 100; i += 1) {
    const ping = spawnSync(join(bin, 'redis-cli'), ['-h', '127.0.0.1', '-p', String(port), 'ping'], { encoding: 'utf8' });
    if (ping.stdout?.trim() === 'PONG') {
      const version = spawnSync(server, ['--version'], { encoding: 'utf8' }).stdout.trim();
      return {
        host: '127.0.0.1',
        port,
        version,
        async stop() {
          proc.kill('SIGTERM');
          for (let j = 0; j < 50 && proc.exitCode === null; j += 1) await sleep(100);
          if (proc.exitCode === null) proc.kill('SIGKILL');
        },
      };
    }
    await sleep(100);
  }
  proc.kill('SIGKILL');
  throw new Error('redis did not become ready');
}
