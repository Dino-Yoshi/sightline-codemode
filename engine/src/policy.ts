export interface ServerPolicy {
  source: 'public' | 'private';
  sink: 'public' | 'private';
  taint: 'trusted' | 'untrusted';
}
export interface Lineage {
  sensitivity: 'public' | 'private' | 'unknown';
  taint: 'trusted' | 'untrusted';
}
export type Decision = { allow: true } | { allow: false; rule: string; reason: string };

/** Unknown sensitivity is treated as private; untrusted taint alone never blocks. */
export function check(argLineage: Lineage, sink: ServerPolicy): Decision {
  if (sink.sink === 'public' && argLineage.sensitivity !== 'public') {
    const source = argLineage.sensitivity === 'unknown' ? 'Unknown lineage is treated as private' : 'Private lineage';
    const taint = argLineage.taint === 'untrusted' ? ' (influenced by untrusted text)' : '';
    return { allow: false, rule: 'private-to-public', reason: `${source}${taint} cannot reach a public sink.` };
  }
  return { allow: true };
}
