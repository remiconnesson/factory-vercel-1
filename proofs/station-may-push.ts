import { defineProof, type Named, type Proof } from '@gdp-ts/core';
import { mayUse } from '@/core/questions';
import type { SandboxStation } from '@/core/types';

const StationMayPush = defineProof('StationMayPush');
/** The rules let station S's agent push its factory branch and work on its PR. */
export interface StationMayPush<S> extends Proof<'StationMayPush', [S]> {}

export function stationMayPush<S>(station: Named<S, SandboxStation>): StationMayPush<S> | null {
  return mayUse(station.value, 'github-push').allow ? StationMayPush.prove(station) : null;
}
