// The rule engine: a Cedar request in, a decision out. Pure and deterministic (no I/O), but it loads the Cedar
// WebAssembly module, so it runs on the host only: never import it from a workflow file.
import { isAuthorized, type CedarValueJson, type EntityJson } from '@cedar-policy/cedar-wasm/nodejs';
import rules from './rules.generated.json';
import type { Decision } from './types';

export type Uid = { type: string; id: string };
export type Request = { principal: Uid; action: string; resource: Uid; context?: Record<string, CedarValueJson>; entities: EntityJson[] };

export function decide(r: Request): Decision {
  const answer = isAuthorized({
    principal: r.principal,
    action: { type: 'Factory::Action', id: r.action },
    resource: r.resource,
    context: r.context ?? {},
    entities: r.entities,
    schema: rules.schema,
    validateRequest: true,
    policies: { staticPolicies: rules.policies },
  });
  if (answer.type === 'failure') throw new Error(`Cedar rejected the request: ${answer.errors.map((e) => e.message).join('; ')}`);
  const { decision, diagnostics } = answer.response;
  if (diagnostics.errors.length) throw new Error(`Cedar policy errors: ${diagnostics.errors.map((e) => `${e.policyId}: ${e.error.message}`).join('; ')}`);
  return { allow: decision === 'allow', reasons: diagnostics.reason };
}
