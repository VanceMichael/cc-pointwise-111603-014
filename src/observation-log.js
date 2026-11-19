import { readJson, writeJsonAtomic } from './json-file.js';
import { appendObservations, observationFromRecord } from './observations.js';

// 观察日志存储：只增不改。追加幂等；冲突（同键不同内容）留痕并保留原观察。
export class ObservationLog {
  constructor(path) { this.path = path; }

  async readState() {
    const state = await readJson(this.path, { observations: [], conflicts: [] });
    if (!Array.isArray(state.observations)) throw new Error('observation log has no observations array');
    if (!Array.isArray(state.conflicts)) throw new Error('observation log has no conflicts array');
    return state;
  }

  async read() {
    return (await this.readState()).observations;
  }

  async summary() {
    const state = await this.readState();
    const bySourceId = {};
    for (const observation of state.observations) {
      bySourceId[observation.sourceId] = (bySourceId[observation.sourceId] ?? 0) + 1;
    }
    return { total: state.observations.length, bySourceId, conflicts: state.conflicts.length };
  }

  async conflicts() {
    return (await this.readState()).conflicts;
  }

  async append(records, { now }) {
    const state = await this.readState();
    const incoming = records.map((record) => observationFromRecord(record, now));
    const { observations, added, conflicts } = appendObservations(state.observations, incoming);
    if (added.length === 0 && conflicts.length === 0) {
      return { added: 0, conflicts: [], total: observations.length };
    }
    const recorded = conflicts.map((conflict) => ({
      key: conflict.key,
      rejectedAt: now,
      kept: conflict.kept,
      rejected: conflict.rejected,
    }));
    await writeJsonAtomic(this.path, {
      observations,
      conflicts: [...state.conflicts, ...recorded],
    });
    return { added: added.length, conflicts: conflicts.map((conflict) => conflict.key), total: observations.length };
  }
}
