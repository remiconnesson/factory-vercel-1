// Bundles factory/stations/*.md into lib/stations.generated.json and factory/skills/*/SKILL.md into
// lib/skills.generated.json, so the deployment doesn't depend on file tracing. Runs before dev, build and type-check.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import matter from 'gray-matter';

const stationsDir = 'factory/stations';
const stations = {};
for (const f of (await readdir(stationsDir)).sort()) {
  if (!f.endsWith('.md')) continue;
  const { data, content } = matter(await readFile(`${stationsDir}/${f}`, 'utf8'));
  stations[f.replace(/\.md$/, '')] = { ...data, template: content };
}
await writeFile('lib/stations.generated.json', JSON.stringify(stations, null, 2) + '\n');

// Harness skill records: the harness renders name and description back into SKILL.md front matter.
const skillsDir = 'factory/skills';
const skills = [];
for (const name of (await readdir(skillsDir)).sort()) {
  const { data, content } = matter(await readFile(`${skillsDir}/${name}/SKILL.md`, 'utf8'));
  if (data.name !== name) throw new Error(`${skillsDir}/${name}/SKILL.md: name must be "${name}"`);
  if (/[:#\n]/.test(data.description)) throw new Error(`${skillsDir}/${name}/SKILL.md: description must be one line without ":" or "#"`);
  skills.push({ name, description: data.description, content: content.trim() + '\n' });
}
await writeFile('lib/skills.generated.json', JSON.stringify(skills, null, 2) + '\n');
