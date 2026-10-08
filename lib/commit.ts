import type { Named } from '@gdp-ts/core';
import type { ChangesAllowed } from '@/proofs/changes-allowed';
import { config } from './config';
import { gh } from './github';
import type { Change } from './sandbox';

/** Commits a station's changes from the host, through the Git Data API. Demands proof the rules allow every path. */
export async function commitChanges<S, C>(
  changes: Named<C, Change[]>,
  a: { branch: string; baseSha: string; message: string },
  _proof: ChangesAllowed<S, C>,
) {
  if (changes.value.length === 0) return null;

  const o = await gh();
  const { owner, repo } = config;
  const base = await o.rest.git.getCommit({ owner, repo, commit_sha: a.baseSha });

  const tree = await Promise.all(changes.value.map(async (c) => ({
    path: c.path,
    mode: c.mode as '100644' | '100755',
    type: 'blob' as const,
    sha: c.deleted ? null : (await o.rest.git.createBlob({ owner, repo, content: c.contentBase64!, encoding: 'base64' })).data.sha,
  })));

  const newTree = await o.rest.git.createTree({ owner, repo, base_tree: base.data.tree.sha, tree });
  const commit = await o.rest.git.createCommit({ owner, repo, message: a.message, tree: newTree.data.sha, parents: [a.baseSha] });

  const ref = `heads/${a.branch}`;
  const exists = await o.rest.git.getRef({ owner, repo, ref }).then(() => true, (e: { status?: number }) => (e.status === 404 ? false : Promise.reject(e)));
  if (exists) await o.rest.git.updateRef({ owner, repo, ref, sha: commit.data.sha, force: false }); // fails if a human pushed meanwhile
  else await o.rest.git.createRef({ owner, repo, ref: `refs/${ref}`, sha: commit.data.sha });
  return commit.data.sha;
}
