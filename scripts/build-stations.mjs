// Bundles factory/stations/*.md into lib/stations.generated.json, so the deployment
// doesn't depend on file tracing. Runs before dev, build and type-check.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import matter from 'gray-matter';

const dir = 'factory/stations';
const out = {};
for (const f of (await readdir(dir)).sort()) {
  if (!f.endsWith('.md')) continue;
  const { data, content } = matter(await readFile(`${dir}/${f}`, 'utf8'));
  out[f.replace(/\.md$/, '')] = { ...data, template: content };
}
await writeFile('lib/stations.generated.json', JSON.stringify(out, null, 2) + '\n');
