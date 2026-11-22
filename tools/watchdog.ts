// Pengawas container Harmony untuk stack Docker.
//
// Kenapa perlu: healthcheck Docker hanya **menandai** container `unhealthy`;
// Docker tidak pernah me-restart container karena status itu. Di mesin ini
// Lavalink sempat macet 13 jam dengan status unhealthy dan tidak ada yang
// mengetahuinya. Watchdog ini dijalankan dari cron, memeriksa langsung, dan
// me-restart setelah dua kegagalan berturut-turut.
//
// Pemeriksaan:
//   - lavalink: status healthcheck Docker (HTTP /v4/info di dalam container)
//   - bot: healthcheck Docker (liveness) dan GET /ready dari dalam container
//
// Bot sengaja TIDAK direstart saat database mati. Restart tidak membetulkan
// database dan justru menambah gangguan; aturan lengkapnya ada di
// `tools/watchdog-lib.ts`.
//
// Pakai: npm run watchdog
// Jadwalkan lewat cron tiap lima menit (lihat README).

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  evaluateBot,
  evaluateLavalink,
  normalizeState,
  planActions,
  type Observation,
  type ReadyChecks,
  type RestartAction,
  type WatchdogState,
} from './watchdog-lib.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATE_FILE = path.join(ROOT, 'data', 'watchdog-state.json');
const CONTAINERS = { bot: 'harmony-bot', lavalink: 'harmony-lavalink' } as const;
const DOCKER_TIMEOUT_MS = 15_000;
const RESTART_TIMEOUT_MS = 90_000;
const WEBHOOK_TIMEOUT_MS = 10_000;

const READY_SCRIPT = [
  "fetch('http://127.0.0.1:8080/ready',{signal:AbortSignal.timeout(3000)})",
  '.then(async(r)=>process.stdout.write(await r.text()))',
  '.catch(()=>process.exit(1))',
].join('');

interface ContainerStatus {
  running: boolean;
  health: string;
}

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function readDotEnv(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed
      .slice(separator + 1)
      .trim()
      .replace(/^["']/, '')
      .replace(/["']$/, '');
    result[key] = value;
  }
  return result;
}

async function readEnvFile(): Promise<Record<string, string>> {
  try {
    return readDotEnv(await fs.readFile(path.join(ROOT, '.env'), 'utf8'));
  } catch {
    return {};
  }
}

function runDocker(args: string[], timeoutMs = DOCKER_TIMEOUT_MS): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`docker ${args.join(' ')} melewati batas ${timeoutMs} ms`));
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

async function inspectContainer(name: string): Promise<ContainerStatus> {
  const result = await runDocker([
    'inspect',
    '-f',
    '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}',
    name,
  ]);

  if (result.code !== 0) {
    return { running: false, health: 'missing' };
  }

  const [status = '', health = 'none'] = result.stdout.trim().split('|');
  return { running: status === 'running', health };
}

function parseReady(text: string): { checks?: ReadyChecks } | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null) return null;
    return parsed as { checks?: ReadyChecks };
  } catch {
    return null;
  }
}

async function readReady(): Promise<{ checks?: ReadyChecks } | null> {
  const result = await runDocker(['exec', CONTAINERS.bot, 'node', '-e', READY_SCRIPT]);
  if (result.code !== 0) return null;
  return parseReady(result.stdout);
}

function loadState(): WatchdogState {
  try {
    return normalizeState(JSON.parse(readFileSync(STATE_FILE, 'utf8')));
  } catch {
    return normalizeState(null);
  }
}

async function saveState(state: WatchdogState): Promise<void> {
  await fs.mkdir(path.dirname(STATE_FILE), { recursive: true });
  const temporary = `${STATE_FILE}.partial`;
  await fs.writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  await fs.rename(temporary, STATE_FILE);
}

function label(target: RestartAction['target']): string {
  return target === 'bot' ? 'bot' : 'Lavalink';
}

async function sendWebhook(url: string, restarts: RestartAction[], failed: string[]): Promise<void> {
  const lines = restarts.map(
    (action) =>
      `- ${label(action.target)}: ${action.reason} (gagal ${action.failures}x berturut-turut)`,
  );
  if (failed.length > 0) {
    lines.push(`- Restart gagal: ${failed.join('; ')}`);
  }

  const payload = {
    content: [`Watchdog Harmony, ${new Date().toISOString()}`, ...lines].join('\n'),
    allowed_mentions: { parse: [] },
  };

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(`webhook tidak bisa dihubungi: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!response.ok) {
    throw new Error(`webhook menolak pesan (HTTP ${response.status})`);
  }
}

async function main(): Promise<void> {
  const dotEnv = await readEnvFile();
  const webhookUrl = (process.env.WATCHDOG_WEBHOOK_URL ?? dotEnv.WATCHDOG_WEBHOOK_URL ?? '').trim();

  const botStatus = await inspectContainer(CONTAINERS.bot);
  const lavalinkStatus = await inspectContainer(CONTAINERS.lavalink);

  const ready = botStatus.running ? await readReady() : null;
  const observations: Record<'bot' | 'lavalink', Observation> = {
    lavalink: evaluateLavalink(lavalinkStatus),
    bot: evaluateBot({
      running: botStatus.running,
      health: botStatus.health,
      ready,
      lavalinkHealthy: evaluateLavalink(lavalinkStatus).ok,
    }),
  };

  const previous = loadState();
  const transition = planActions(previous, observations);

  const recovered = (['bot', 'lavalink'] as const).filter(
    (target) => previous[target].failures > 0 && observations[target].ok,
  );
  for (const target of recovered) {
    console.log(`Pulih: ${label(target)}`);
  }

  for (const [target, observation] of Object.entries(observations) as Array<
    [RestartAction['target'], Observation]
  >) {
    if (!observation.ok && transition.state[target].failures > 0) {
      console.warn(
        `Pemeriksaan gagal (${transition.state[target].failures}/2): ${label(target)}: ${observation.reason ?? '-'}`,
      );
    }
  }

  await saveState(transition.state);

  if (transition.restarts.length === 0) return;

  const failed: string[] = [];
  for (const action of transition.restarts) {
    console.warn(`Restart ${label(action.target)}: ${action.reason}`);
    const result = await runDocker(['restart', CONTAINERS[action.target]], RESTART_TIMEOUT_MS);
    if (result.code !== 0) {
      failed.push(`${label(action.target)}: ${(result.stderr || result.stdout).trim()}`);
      console.error(`Restart ${label(action.target)} gagal: ${(result.stderr || result.stdout).trim()}`);
    }
  }

  if (webhookUrl === '') {
    console.warn('WATCHDOG_WEBHOOK_URL kosong; restart dilakukan tanpa notifikasi.');
  } else {
    await sendWebhook(webhookUrl, transition.restarts, failed);
  }

  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(`Gagal: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
