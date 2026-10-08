// Bundles the factory's text sources into JSON so the deployment doesn't depend on file tracing:
//   factory/stations/*.md     → lib/stations.generated.json
//   factory/skills/*/SKILL.md → lib/skills.generated.json
//   core/rules/*.cedar        → core/rules.generated.json (validated against core/rules/factory.cedarschema)
// Runs before dev, build, type-check, tests and checks.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import matter from 'gray-matter';
import { policySetTextToParts, validate } from '@cedar-policy/cedar-wasm/nodejs';

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

// Cedar rules: one entry per policy, keyed by its @id, which is what a decision reports as its reason.
const rulesDir = 'core/rules';
const schema = await readFile(`${rulesDir}/factory.cedarschema`, 'utf8');
const policies = {};
for (const f of (await readdir(rulesDir)).sort()) {
  if (!f.endsWith('.cedar')) continue;
  const parts = policySetTextToParts(await readFile(`${rulesDir}/${f}`, 'utf8'));
  if (parts.type !== 'success') throw new Error(`${rulesDir}/${f}: ${parts.errors.map((e) => e.message).join('; ')}`);
  for (const text of parts.policies) {
    const id = /@id\("([^"]+)"\)/.exec(text)?.[1];
    if (!id) throw new Error(`${rulesDir}/${f}: every policy needs an @id("..."):\n${text}`);
    if (policies[id]) throw new Error(`${rulesDir}/${f}: duplicate policy id "${id}"`);
    policies[id] = text;
  }
}
const check = validate({ schema, policies: { staticPolicies: policies }, validationSettings: { mode: 'strict' } });
const problems = check.type === 'success' ? check.validationErrors.map((e) => `${e.policyId}: ${e.error.message}`) : check.errors.map((e) => e.message);
if (problems.length) throw new Error(`Cedar rules don't validate against the schema:\n- ${problems.join('\n- ')}`);
await writeFile('core/rules.generated.json', JSON.stringify({ schema, policies }, null, 2) + '\n');
