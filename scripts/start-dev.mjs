import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { platform } from 'node:os';
import { resolve } from 'node:path';

const root = process.cwd();
const envPath = resolve(root, '.env');
const envExamplePath = resolve(root, '.env.example');
const frontUrl = 'http://127.0.0.1:5173';

if (!existsSync(envPath)) {
  if (existsSync(envExamplePath)) {
    console.log('[info] .env not found, copying from .env.example...');
    const { copyFileSync } = await import('node:fs');
    copyFileSync(envExamplePath, envPath);
    console.log('[info] 已从 .env.example 复制生成 .env，请先填写 Home Assistant token 和地址后再重新运行。');
    const opener = platform() === 'darwin' ? 'open' : platform() === 'win32' ? 'start' : 'xdg-open';
    const args = platform() === 'win32' ? ['','https://github.com/chllhc-SVG/home-assistant-mcp#readme'] : ['https://github.com/chllhc-SVG/home-assistant-mcp#readme'];
    spawn(opener, args, { stdio: 'ignore', detached: true, shell: true }).unref();
    process.exit(0);
  }
  console.error('[error] 缺少 .env，请创建后再启动。');
  process.exit(1);
}

const run = process.platform === 'win32' ? 'cmd' : 'docker';
const args = process.platform === 'win32' ? ['/c', 'docker compose up -d --build'] : ['compose', 'up', '-d', '--build'];

console.log('[info] 启动 Docker Compose...');
const child = spawn(run, args, { stdio: 'inherit', shell: process.platform === 'win32' });
child.on('exit', (code) => {
  if (code !== 0) process.exit(code ?? 1);
  console.log('');
  console.log(`[info] 系统页面: ${frontUrl}`);
  console.log('[info] MCP API:   http://127.0.0.1:4000/healthz');
  const opener = platform() === 'darwin' ? 'open' : platform() === 'win32' ? 'start' : 'xdg-open';
  spawn(opener, [frontUrl], { stdio: 'ignore', detached: true, shell: true }).unref();
});
