export interface ServerPolicy {
  source: 'public' | 'private';
  sink: 'public' | 'private';
  taint: 'trusted' | 'untrusted';
}
export interface Lineage {
  sensitivity: 'public' | 'private' | 'unknown';
  taint: 'trusted' | 'untrusted';
}

/**
 * Extra, optional context the observer passes in so the block reason can name
 * the real private source(s) and the sink in one plain sentence. All fields are
 * optional, so existing callers (and the policy unit tests) can keep calling
 * `check(lineage, sink)` with two arguments.
 */
export interface ReasonContext {
  /** The argument that carried the blocking lineage, e.g. "body" or "total". */
  argName?: string;
  /** The sink server the call was aimed at, e.g. "tracker". */
  sinkServer?: string;
  /** Private source call sites in the argument's lineage, e.g. ["payroll.get_salaries"]. */
  sources?: string[];
  /** True only when an untrusted value is really in the argument's lineage. */
  untrusted?: boolean;
}

export type Decision = { allow: true } | { allow: false; rule: string; reason: string };

/** Unknown sensitivity is treated as private; untrusted taint alone never blocks. */
export function check(argLineage: Lineage, sink: ServerPolicy, ctx: ReasonContext = {}): Decision {
  if (sink.sink === 'public' && argLineage.sensitivity !== 'public') {
    return { allow: false, rule: 'private-to-public', reason: buildReason(argLineage, sink, ctx) };
  }
  return { allow: true };
}

/**
 * One plain sentence that names the private source and the public sink, e.g.
 *   "total comes from payroll.get_salaries (private) and tracker is public,
 *    so the call was blocked before it was sent."
 * Untrusted text is mentioned only when an untrusted value is really in lineage.
 */
function buildReason(argLineage: Lineage, sink: ServerPolicy, ctx: ReasonContext): string {
  const subject = ctx.argName ?? 'the value';
  const sinkName = ctx.sinkServer ?? 'a public sink';
  const sinkClause = ctx.sinkServer ? `${sinkName} is public` : `${sinkName} is public`;

  // Describe where the blocking lineage came from.
  let origin: string;
  if (ctx.sources && ctx.sources.length > 0) {
    const names = ctx.sources.join(', ');
    origin = `comes from ${names} (private)`;
  } else if (argLineage.sensitivity === 'unknown') {
    // Fail-closed: we couldn't follow the lineage, so we treat it as private.
    origin = `has lineage we could not follow, so it is treated as private`;
  } else {
    origin = `is private`;
  }

  // Only mention untrusted text when an untrusted value truly reached the arg.
  const untrusted = ctx.untrusted ? ' and is influenced by untrusted text' : '';

  return `${subject} ${origin}${untrusted} and ${sinkClause}, so the call was blocked before it was sent.`;
}
