import { defineProof, type Named, type Proof } from '@gdp-ts/core';
import { mayStart as decideStart } from '@/core/questions';
import type { Trigger } from '@/core/types';
import { config } from '@/lib/config';

const MayStart = defineProof('MayStart');
/** The rules (core/rules/triggers.cedar) let this exact webhook trigger start what it asks for. */
export interface MayStart<T> extends Proof<'MayStart', [T]> {}

export function mayStart<T>(trigger: Named<T, Trigger>): MayStart<T> | null {
  return decideStart(trigger.value, config.allowedUsers).allow ? MayStart.prove(trigger) : null;
}
