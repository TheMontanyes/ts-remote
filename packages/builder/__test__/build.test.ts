import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import build from '../build';

let tmpDir: string;

function writeFiles(files: Record<string, string>): string {
  const srcDir = path.join(tmpDir, 'src');
  for (const [name, content] of Object.entries(files)) {
    const filePath = path.join(srcDir, name);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  }
  return srcDir;
}

async function buildModule(srcDir: string, moduleName = 'test'): Promise<string> {
  const outputPath = path.join(tmpDir, 'dist', 'types.d.ts');
  await build({
    entries: [{ name: moduleName, filename: path.join(srcDir, 'index.ts') }],
    output: { filename: outputPath },
    tsconfig: path.resolve(process.cwd(), 'tsconfig.json'),
  });
  return fs.readFileSync(outputPath, 'utf-8');
}

describe('builder: declaration emit', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-remote-build-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('emits a class exported inline via `export class`', async () => {
    const srcDir = writeFiles({
      'foo.ts': `export class Foo { bar(): number { return 1; } }`,
      'index.ts': `export { Foo } from './foo';`,
    });

    const dts = await buildModule(srcDir);

    assert.match(dts, /class Foo\b/, 'class Foo declaration should be present');
    assert.match(dts, /bar\(\): number;/, 'class members should be present');
  });

  it('emits a class exported via a standalone `export { X }` statement', async () => {
    // Regression: the `class X {} ... export { X }` pattern was misdetected as
    // an internal name collision, renamed to `X_1`, and dropped from the output —
    // leaving the class referenced only as a type.
    const srcDir = writeFiles({
      'foo.ts': `class Foo { bar(): number { return 1; } }\nexport { Foo };`,
      'index.ts': `export { Foo } from './foo';`,
    });

    const dts = await buildModule(srcDir);

    assert.match(dts, /class Foo\b/, 'class Foo declaration must be emitted, not just referenced');
    assert.match(dts, /bar\(\): number;/, 'class members should be present');
    assert.doesNotMatch(dts, /Foo_1/, 'class must not be renamed as a false collision');
    assert.match(dts, /export \{[^}]*\bFoo\b/, 'Foo should be exported');
  });

  it('emits a class consumed only as a type elsewhere when exported via `export { X }`', async () => {
    // Reproduces the original report: a factory/instance references HttpClient as
    // a type while the class itself is exported through `export { HttpClient }`.
    const srcDir = writeFiles({
      'client.ts': `class Client { ping(): void {} }\nexport { Client };`,
      'factory.ts': `import { Client } from './client';\nexport class Factory { static create(): Client { return new Client(); } }`,
      'index.ts': `export { Client } from './client';\nexport { Factory } from './factory';`,
    });

    const dts = await buildModule(srcDir);

    assert.match(dts, /class Client\b/, 'class Client must be emitted as a declaration');
    assert.match(dts, /class Factory\b/, 'class Factory must be emitted');
    assert.match(dts, /static create\(\): Client;/, 'Factory should reference Client as a type');
    assert.doesNotMatch(dts, /Client_1/, 'Client must not be renamed');
  });

  it('still resolves genuine name collisions between exported and internal symbols', async () => {
    // The exported `Status` and the unrelated internal `Status` in helper.ts must
    // remain distinct: the internal one is renamed, the exported one is not.
    const srcDir = writeFiles({
      'helper.ts': `type Status = 'internal';\nexport function describe(s: Status): string { return s; }`,
      'index.ts': `export type Status = 'a' | 'b';\nexport { describe } from './helper';`,
    });

    const dts = await buildModule(srcDir);

    assert.match(
      dts,
      /type Status = ['"]a['"] \| ['"]b['"]/,
      'exported Status should keep its name',
    );
    assert.match(dts, /Status_1/, 'internal colliding Status should be renamed');
  });
});
