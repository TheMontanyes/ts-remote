import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import ts from 'typescript';
import { getCompilerOptions } from '../get-compiler-options';

let tmpDir: string;

function write(name: string, content: string): string {
  const filePath = path.join(tmpDir, name);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return filePath;
}

describe('getCompilerOptions', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-remote-tscfg-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reads compilerOptions from a tsconfig', () => {
    const cfg = write('tsconfig.json', JSON.stringify({ compilerOptions: { strict: true } }));
    const opts = getCompilerOptions(cfg);
    assert.equal(opts.strict, true);
  });

  it('applies overrides on top of the file options', () => {
    const cfg = write(
      'tsconfig.json',
      JSON.stringify({ compilerOptions: { declaration: false, strict: true } }),
    );
    const opts = getCompilerOptions(cfg, { declaration: true });
    assert.equal(opts.declaration, true, 'override should win');
    assert.equal(opts.strict, true, 'unrelated file options should be preserved');
  });

  it('resolves options inherited through `extends`', () => {
    write(
      'tsconfig.base.json',
      JSON.stringify({ compilerOptions: { strict: true, target: 'ES2020' } }),
    );
    const cfg = write(
      'tsconfig.json',
      JSON.stringify({ extends: './tsconfig.base.json', compilerOptions: { declaration: true } }),
    );

    const opts = getCompilerOptions(cfg);
    assert.equal(opts.strict, true, 'strict should be inherited from the base config');
    assert.equal(opts.target, ts.ScriptTarget.ES2020, 'target should be inherited');
    assert.equal(opts.declaration, true, 'own options should still apply');
  });

  it('does not fail when include/files match no inputs (TS18003)', () => {
    // The builder only reads compilerOptions and passes entry files itself, so a
    // tsconfig whose globs match nothing must still resolve.
    const cfg = write(
      'tsconfig.json',
      JSON.stringify({ compilerOptions: { strict: true }, include: ['src/**/*.ts'] }),
    );

    assert.doesNotThrow(() => getCompilerOptions(cfg));
    assert.equal(getCompilerOptions(cfg).strict, true);
  });

  it('throws when no path is provided', () => {
    assert.throws(() => getCompilerOptions(undefined), /No tsconfig path/);
  });

  it('throws with a clear message when the file does not exist', () => {
    assert.throws(
      () => getCompilerOptions(path.join(tmpDir, 'nope.json')),
      /Failed to read tsconfig/,
    );
  });

  it('throws on malformed JSON', () => {
    const cfg = write('tsconfig.json', '{ "compilerOptions": { "strict": true,, } }');
    assert.throws(() => getCompilerOptions(cfg), /Failed to read tsconfig/);
  });

  it('throws when `extends` points to a missing file', () => {
    const cfg = write(
      'tsconfig.json',
      JSON.stringify({ extends: './missing.json', compilerOptions: {} }),
    );
    assert.throws(() => getCompilerOptions(cfg), /Invalid tsconfig|Cannot read file/);
  });

  it('throws on an invalid option value', () => {
    const cfg = write('tsconfig.json', JSON.stringify({ compilerOptions: { target: 'NOPE' } }));
    assert.throws(() => getCompilerOptions(cfg), /Invalid tsconfig/);
  });
});
