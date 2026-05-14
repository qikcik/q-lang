// tests/helpers.js — shared test runner infrastructure
//
// Exports:  test, suite, assert, assertEq, assertThrows, compileAndGenerate, summarize

import { compile }  from '../compiler/pipeline.js';
import { generate } from '../compiler/codegen.js';

export const counters = { passed: 0, failed: 0, errors: [] };

// Async test support: promises are collected here and awaited in summarize().
const _asyncTests = [];

export function test(name, fn) {
  let result;
  try {
    result = fn();
  } catch (e) {
    console.error(`  ✗  ${name}`);
    console.error(`       ${e.message}`);
    counters.failed++;
    counters.errors.push({ name, error: e });
    return;
  }

  if (result instanceof Promise) {
    _asyncTests.push(
      result.then(() => {
        console.log(`  ✓  ${name}`);
        counters.passed++;
      }).catch(e => {
        console.error(`  ✗  ${name}`);
        console.error(`       ${e.message}`);
        counters.failed++;
        counters.errors.push({ name, error: e });
      }),
    );
  } else {
    console.log(`  ✓  ${name}`);
    counters.passed++;
  }
}

export function suite(name) {
  console.log(`\n── ${name} ──`);
}

export function assert(cond, msg = 'assertion failed') {
  if (!cond) throw new Error(msg);
}

export function assertEq(a, b, msg) {
  if (a !== b) throw new Error(msg ?? `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

export function assertThrows(fn, ErrorClass, msgIncludes) {
  let threw = false;
  try { fn(); }
  catch (e) {
    threw = true;
    if (ErrorClass) assert(e instanceof ErrorClass, `expected ${ErrorClass.name}, got ${e.constructor.name}`);
    if (msgIncludes) assert(e.message.includes(msgIncludes), `error message "${e.message}" missing "${msgIncludes}"`);
  }
  if (!threw) throw new Error(`expected ${ErrorClass?.name ?? 'error'} to be thrown`);
}

export function compileAndGenerate(src) {
  const { ast } = compile(src);
  return generate(ast).bytes;
}

export async function summarize() {
  if (_asyncTests.length > 0) await Promise.all(_asyncTests);
  const { passed, failed, errors } = counters;
  const total = passed + failed;
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Tests: ${total}  ✓ ${passed}  ✗ ${failed}`);
  if (failed > 0) {
    console.log('\nFailed tests:');
    for (const { name } of errors) console.log(`  • ${name}`);
    process.exit(1);
  } else {
    console.log('All tests passed.');
  }
}
