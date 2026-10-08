import { defineProof, type Named, type Proof } from '@gdp-ts/core';
import { refusedChanges } from '@/core/questions';
import type { SandboxStation } from '@/core/types';

const ChangesAllowed = defineProof('ChangesAllowed');
/** The rules let station S change every path in change set C. */
export interface ChangesAllowed<S, C> extends Proof<'ChangesAllowed', [S, C]> {}

export function changesAllowed<S, C>(station: Named<S, SandboxStation>, changes: Named<C, readonly { path: string }[]>): ChangesAllowed<S, C> | null {
  return refusedChanges(station.value, changes.value.map((c) => c.path)).length === 0 ? ChangesAllowed.prove(station, changes) : null;
}
