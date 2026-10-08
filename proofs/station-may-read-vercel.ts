import { defineProof, type Named, type Proof } from '@gdp-ts/core';
import { mayUse } from '@/core/questions';
import type { SandboxStation } from '@/core/types';

const StationMayReadVercel = defineProof('StationMayReadVercel');
/** The rules let station S's agent read the project's deployments, logs and previews. */
export interface StationMayReadVercel<S> extends Proof<'StationMayReadVercel', [S]> {}

export function stationMayReadVercel<S>(station: Named<S, SandboxStation>): StationMayReadVercel<S> | null {
  return mayUse(station.value, 'vercel').allow ? StationMayReadVercel.prove(station) : null;
}
