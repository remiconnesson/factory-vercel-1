// The trusted modules that need no I/O. (The ones that read GitHub are exercised by `pnpm check`.)
import { name } from '@gdp-ts/core';
import { describe, expect, it } from 'vitest';
import type { SandboxStation, Trigger } from '@/core/types';
import { changesAllowed } from './changes-allowed';
import { mayStart } from './may-start';
import { stationMayPush } from './station-may-push';
import { stationMayReadVercel } from './station-may-read-vercel';

const station = (s: SandboxStation) => s;

describe('proofs', () => {
  it('mayStart uses FACTORY_ALLOWED_USERS', () => {
    const t = (login: string): Trigger => ({ action: 'startTriage', actor: { login, kind: 'User' }, issue: 1, issueAuthor: login });
    expect(name(t('alice'), (x) => mayStart(x) !== null)).toBe(true);
    expect(name(t('mallory'), (x) => mayStart(x) !== null)).toBe(false);
  });
  it('only Dev gets a push proof; every sandbox station gets a Vercel proof', () => {
    expect(name(station('implement'), (s) => stationMayPush(s) !== null)).toBe(true);
    expect(name(station('spec'), (s) => stationMayPush(s) !== null)).toBe(false);
    expect(name(station('spec'), (s) => stationMayReadVercel(s) !== null)).toBe(true);
  });
  it('changesAllowed needs every path to be allowed', () => {
    expect(name(station('spec'), [{ path: 'specs/1/PRODUCT.md' }], (s, c) => changesAllowed(s, c) !== null)).toBe(true);
    expect(name(station('spec'), [{ path: 'specs/1/PRODUCT.md' }, { path: 'app/page.tsx' }], (s, c) => changesAllowed(s, c) !== null)).toBe(false);
  });
});
