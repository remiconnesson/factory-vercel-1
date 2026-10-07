import { config } from '@/lib/config';

const stations = [
  ['issue opened', 'Triage', 'Checks the issue, flags questions', 'ready-to-spec or needs-info'],
  ['ready-to-spec', 'Spec', 'Writes specs/<n>/PRODUCT.md and TECH.md, opens a draft PR', 'a human applies ready-to-implement'],
  ['ready-to-implement', 'Implement', 'Implements the specs, runs the verification, marks the PR ready', 'the PR event triggers Review'],
  ['PR ready / updated', 'Review', 'Reviews the diff against the specs', 'posts review comments'],
];

export default function Home() {
  const target = config.owner && config.repo ? `${config.owner}/${config.repo}` : 'not configured';
  return (
    <main>
      <h1>Software factory</h1>
      <p>
        Target repository: <code>{target}</code>
      </p>
      <p>
        Webhook: <code>POST /api/github/webhook</code> (Issues and Pull requests events)
      </p>
      <table>
        <thead>
          <tr>
            <th>Label / event</th>
            <th>Station</th>
            <th>What it does</th>
            <th>Next</th>
          </tr>
        </thead>
        <tbody>
          {stations.map(([trigger, station, what, next]) => (
            <tr key={station}>
              <td>
                <code>{trigger}</code>
              </td>
              <td>{station}</td>
              <td>{what}</td>
              <td>{next}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
