// Test support (not a test file): a stand-in for `dotnet test` that writes
// real-format TRX results, so the dotnet-test runner can be tested without a
// .NET SDK. Each test project is a directory named *.Tests with a *.csproj. Each xUnit test
// method passes when the project's non-test sources contain the token named by
// the `// requires: TOKEN` comment in its body (sources outside *Tests.cs files); `[Fact(Skip = ...)]` does not
// run. Markers: `#error` in a source is a compile error, BROKEN-PACKAGE in a
// project file a restore error, TRUNCATED-TRX in a source a TRX whose counter
// disagrees with its results, LEAK in a token a failure message carrying an
// environment secret.
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

const args = process.argv.slice(2);
if (args[0] === '--version') {
  console.log('8.0.0-fake');
  process.exit(0);
}
const resultsDir = args[args.indexOf('--results-directory') + 1];

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (['bin', 'obj'].includes(name)) return [];
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const all = files(process.cwd());
const projects = all.filter((f) => f.endsWith('.csproj')).map((f) => ({ file: f, dir: f.slice(0, -basename(f).length - 1) }));
const testProjects = projects.filter((p) => p.dir.endsWith('.Tests'));
const impl = all.filter((f) => f.endsWith('.cs') && !/Tests?\.cs$/.test(f)).map((f) => readFileSync(f, 'utf8')).join('\n');

for (const p of projects) {
  if (readFileSync(p.file, 'utf8').includes('BROKEN-PACKAGE')) {
    console.log(`${p.file} : error NU1101: Unable to find package Broken.Package. No packages exist with this id in source(s): nuget.org`);
    process.exit(1);
  }
}
for (const f of all.filter((x) => x.endsWith('.cs'))) {
  const lines = readFileSync(f, 'utf8').split('\n');
  const at = lines.findIndex((l) => l.trim().startsWith('#error'));
  if (at >= 0) {
    console.log(`${f}(${at + 1},1): error CS1029: #error: 'broken' [${projects[0]?.file ?? ''}]`);
    process.exit(1);
  }
}

let anyFailed = false;
for (const p of testProjects) {
  const sources = all.filter((f) => f.startsWith(`${p.dir}/`) && f.endsWith('.cs'));
  const results = [];
  let truncated = false;
  for (const f of sources.filter((x) => /Tests?\.cs$/.test(x))) {
    const text = readFileSync(f, 'utf8');
    truncated ||= text.includes('TRUNCATED-TRX');
    const cls = text.match(/class\s+(\w+)/)?.[1] ?? 'Unknown';
    for (const m of text.matchAll(/\[(Fact|Theory)([^\]]*)\][\s\S]*?public\s+void\s+(\w+)\s*\(\)\s*\{([\s\S]*?)\n\s*\}/g)) {
      const name = `Sample.Tests.${cls}.${m[3]}`;
      const line = text.slice(0, m.index).split('\n').length + 1;
      const token = m[4].match(/requires:\s*(\S+)/)?.[1] ?? '';
      if (/Skip\s*=/.test(m[2])) {
        results.push({ name, outcome: 'NotExecuted' });
      } else if (impl.includes(token)) {
        results.push({ name, outcome: 'Passed' });
      } else {
        anyFailed = true;
        const leak = token.includes('LEAK') ? ` (connection ${process.env.JWT_ACCESS_SECRET})` : '';
        results.push({ name, outcome: 'Failed', message: `Assert.Contains() Failure: "${token}" not found${leak}`, stack: `   at ${name}() in ${f}:line ${line}` });
      }
    }
  }
  const body = results.map((r) => (r.outcome === 'Failed'
    ? `    <UnitTestResult testName="${esc(r.name)}" computerName="fake-host" outcome="Failed">\n      <Output>\n        <ErrorInfo>\n          <Message>${esc(r.message)}</Message>\n          <StackTrace>${esc(r.stack)}</StackTrace>\n        </ErrorInfo>\n      </Output>\n    </UnitTestResult>`
    : `    <UnitTestResult testName="${esc(r.name)}" computerName="fake-host" outcome="${r.outcome}" />`)).join('\n');
  const total = results.length + (truncated ? 1 : 0);
  const passed = results.filter((r) => r.outcome === 'Passed').length;
  const failed = results.filter((r) => r.outcome === 'Failed').length;
  mkdirSync(resultsDir, { recursive: true });
  writeFileSync(join(resultsDir, `results_${relative(process.cwd(), p.dir).replace(/\W+/g, '_')}.trx`),
    `﻿<?xml version="1.0" encoding="utf-8"?>\n<TestRun id="00000000-0000-0000-0000-000000000000" name="@fake-host" xmlns="http://microsoft.com/schemas/VisualStudio/TeamTest/2010">\n  <Results>\n${body}\n  </Results>\n  <ResultSummary outcome="${failed ? 'Failed' : 'Completed'}">\n    <Counters total="${total}" executed="${passed + failed}" passed="${passed}" failed="${failed}" error="0" timeout="0" aborted="0" inconclusive="0" passedButRunAborted="0" notRunnable="0" notExecuted="${results.length - passed - failed}" disconnected="0" warning="0" completed="0" inProgress="0" pending="0" />\n  </ResultSummary>\n</TestRun>\n`);
}
console.log(anyFailed ? 'Failed!' : 'Passed!');
process.exit(anyFailed ? 1 : 0);
