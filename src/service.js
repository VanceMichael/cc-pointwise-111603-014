import { findRecords, mergeRecords, normalizeRecord } from './records.js';

export class CollectionService {
  constructor(repository, { observationLog } = {}) {
    this.repository = repository;
    this.observationLog = observationLog;
  }

  async ingest(inputs, { now } = {}) {
    if (!Array.isArray(inputs)) throw new TypeError('ingest input must be an array');
    const accepted = inputs.map(normalizeRecord);
    const current = await this.repository.read();
    const merged = mergeRecords(current, accepted);
    await this.repository.replace(merged);
    const result = { accepted: accepted.length, stored: merged.length };
    if (this.observationLog) {
      // 观察日志只增不改：重放幂等，冲突留痕，已发布比较不受采集影响。
      result.observations = await this.observationLog.append(accepted, { now: now ?? new Date().toISOString() });
    }
    return result;
  }

  async query(filters) { return findRecords(await this.repository.read(), filters); }
}
