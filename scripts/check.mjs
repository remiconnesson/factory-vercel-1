// Runs a check from checks/ against the configured target with the real lib/ code. The check is bundled as ESM with
// esbuild (packages stay external, so node resolves them from node_modules) and run with .env.local loaded.
// Usage: pnpm check <name> [args...]
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { build } from 'esbuild';

const [name, ...args] = process.argv.slice(2);
const checks = readdirSync('checks').filter((f) => f.endsWith('.ts') && !f.startsWith('_')).map((f) => f.slice(0, -3));
if (!name || !checks.includes(name)) {
  console.error(`usage: pnpm check <${checks.join('|')}> [args...]`);
  process.exit(2);
}
const outfile = `.checks/${name}.mjs`;
await build({ entryPoints: [`checks/${name}.ts`], bundle: true, platform: 'node', format: 'esm', packages: 'external', outfile, logLevel: 'warning' });
const env = existsSync('.env.local') ? ['--env-file=.env.local'] : [];
process.exit(spawnSync(process.execPath, [...env, outfile, ...args], { stdio: 'inherit' }).status ?? 1);
