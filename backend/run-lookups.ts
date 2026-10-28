// Backend function: runs lookups that are due (called every 15 minutes by config/schedules.yml),
// or a single lookup when called with { "lookupId": "..." }.
// Cribl authorizes these calls with the App's grants in config/policies.yml, not the caller's role.

import { describeError } from '../src/lookup-manager/core/publish';
import { isDue, runLookup } from '../src/lookup-manager/core/runner';
import { getSettings, listDefinitions } from '../src/lookup-manager/core/store';

const BUDGET_MS = 540_000; // stay inside the 600 s timeout declared in config/backend.yml

export async function onRequest(request: Request, context: { invocationId?: string }) {
  const started = Date.now();
  const body = (await request.json().catch(() => ({}))) as { action?: string; lookupId?: string; scheduledFor?: string };
  const reply = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

  if (body.action === 'ping') return reply({ ok: true });

  try {
    const settings = await getSettings();
    const defs = await listDefinitions();
    const selected = body.lookupId ? defs.filter((d) => d.id === body.lookupId) : defs.filter((d) => isDue(d));
    const results: { id: string; status: string; rows: number }[] = [];
    const deferred: string[] = [];

    for (const def of selected) {
      if (Date.now() - started > BUDGET_MS) {
        deferred.push(def.id);
        continue;
      }
      const run = await runLookup(def, settings, body.lookupId ? 'manual' : 'schedule', (m) => console.info(`[${def.name}] ${m}`), {
        useStaging: true,
        skipIfUnchanged: !body.lookupId,
        requestWorkerData: true,
      });
      results.push({ id: def.id, status: run.status, rows: run.rows });
      console.info(`[${def.name}] finished: ${run.status}, ${run.rows} rows (invocation ${context?.invocationId ?? '-'})`);
    }
    if (deferred.length) console.warn(`Out of time; deferred to the next schedule: ${deferred.join(', ')}`);
    return reply({ ran: results, deferred, scheduledFor: body.scheduledFor ?? null });
  } catch (e) {
    console.error(`Lookup runner failed: ${describeError(e)}`);
    return reply({ error: describeError(e) }, 500);
  }
}
