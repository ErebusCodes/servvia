// Command-line parsing and dispatch. Options are `--name value`; `--ref key=value` may repeat; anything
// else is refused before the log is touched.
import { derive } from './derive.mjs';
import { DEFAULT_LOG, Refused, inspect } from './log.mjs';
import { record } from './record.mjs';
import { summary } from './summary.mjs';

const ALLOWED = {
  record: ['log', 'story', 'type', 'phase', 'reason', 'value', 'unit', 'corrects', 'note', 'objective-id', 'ref', 'at'],
  derive: ['log', 'repo', 'objective-id', 'story', 'state-dir', 'evidence-dir', 'integration'],
  verify: ['log'],
  summary: ['log', 'story', 'epic', 'format'],
};

function parse(argv) {
  const [command, ...rest] = argv;
  if (!Object.hasOwn(ALLOWED, command ?? '')) throw new Refused(`usage: telemetry.mjs <${Object.keys(ALLOWED).join('|')}> [--option value]…`);
  const opts = { ref: [] };
  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i];
    const name = flag.startsWith('--') ? flag.slice(2) : null;
    if (!name || !ALLOWED[command].includes(name)) throw new Refused(`unknown option for ${command}: ${flag}`);
    const value = rest[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Refused(`${flag} needs a value`);
    if (name === 'ref') opts.ref.push(value);
    else if (Object.hasOwn(opts, name)) throw new Refused(`${flag} is given more than once`);
    else opts[name] = value;
  }
  return { command, opts };
}

export function main(argv, env, out, err) {
  try {
    const { command, opts } = parse(argv);
    if (command === 'record') out(record(opts, env));
    else if (command === 'derive') out(derive(opts));
    else if (command === 'summary') out(summary(opts));
    else {
      const log = inspect(opts.log ?? DEFAULT_LOG);
      if (log.problem) { err(`verify failed at seq ${log.problem.seq}: ${log.problem.reason}\n`); return 1; }
      out(`ok ${log.events.length} events\n`);
    }
    return 0;
  } catch (error) {
    if (!(error instanceof Refused)) throw error;
    err(`refused: ${error.message}\n`);
    return 1;
  }
}
