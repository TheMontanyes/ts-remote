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

  describe('additionalDeclarations', () => {
    const globalDts = [
      'interface Bar {',
      '  baz: string;',
      '}',
      '',
      'declare var appGlobals: { bar: Bar };',
      '',
    ].join('\n');

    const indexTs = 'export const getBar = () => appGlobals.bar;\n';

    async function buildWithAdditional(
      additionalDeclarations: Parameters<typeof build>[0]['additionalDeclarations'],
    ): Promise<string> {
      const srcDir = writeFiles({ 'global.d.ts': globalDts, 'index.ts': indexTs });
      const outputPath = path.join(tmpDir, 'dist', 'types.d.ts');

      await build({
        entries: [{ name: 'test', filename: path.join(srcDir, 'index.ts') }],
        output: { filename: outputPath },
        tsconfig: path.resolve(process.cwd(), 'tsconfig.json'),
        additionalDeclarations,
      });

      return fs.readFileSync(outputPath, 'utf-8');
    }

    it('uses global declarations for typing and concatenates them into the output', async () => {
      const dts = await buildWithAdditional([path.join(tmpDir, 'src', 'global.d.ts')]);

      assert.match(dts, /getBar: \(\) => Bar/, 'emitted types should resolve the global Bar');
      assert.match(dts, /interface Bar\b/, 'global interface must be shipped');
      assert.match(
        dts,
        /declare var appGlobals/,
        'top-level declare statements must be shipped verbatim',
      );
      assert.ok(
        dts.indexOf('interface Bar') < dts.indexOf('declare module "test"'),
        'globals should precede the module blocks',
      );
    });

    it('keeps emit: false declarations out of the output but visible to the compiler', async () => {
      const dts = await buildWithAdditional([
        { filename: path.join(tmpDir, 'src', 'global.d.ts'), emit: false },
      ]);

      assert.match(dts, /getBar: \(\) => Bar/, 'typing should still see the environment');
      assert.doesNotMatch(dts, /interface Bar\b/, 'environment-only file must not be shipped');
      assert.doesNotMatch(dts, /declare var appGlobals/);
    });

    it('rejects additional declarations that are not .d.ts files', async () => {
      await assert.rejects(() => buildWithAdditional([path.join(tmpDir, 'src', 'index.ts')]), {
        message: /must be \.d\.ts files/,
      });
    });

    it('concatenates multiple files in the given order and honors mixed emit flags', async () => {
      const srcDir = writeFiles({
        'first.d.ts': 'interface First {\n  a: string;\n}\n',
        'second.d.ts': 'interface Second {\n  b: First;\n}\n',
        'env-only.d.ts': 'declare var envThing: { second: Second };\n',
        'index.ts': 'export const get = () => envThing.second;\n',
      });
      const outputPath = path.join(tmpDir, 'dist', 'types.d.ts');

      await build({
        entries: [{ name: 'test', filename: path.join(srcDir, 'index.ts') }],
        output: { filename: outputPath },
        tsconfig: path.resolve(process.cwd(), 'tsconfig.json'),
        additionalDeclarations: [
          path.join(srcDir, 'first.d.ts'),
          path.join(srcDir, 'second.d.ts'),
          { filename: path.join(srcDir, 'env-only.d.ts'), emit: false },
        ],
      });

      const dts = fs.readFileSync(outputPath, 'utf-8');

      assert.match(dts, /get: \(\) => Second/, 'typing should see all three declaration files');
      assert.match(dts, /interface First\b/);
      assert.match(dts, /interface Second\b/);
      assert.doesNotMatch(dts, /envThing/, 'emit: false file must not be shipped');
      assert.ok(
        dts.indexOf('interface First') < dts.indexOf('interface Second') &&
          dts.indexOf('interface Second') < dts.indexOf('declare module "test"'),
        'files should be concatenated in the given order, before the module blocks',
      );
    });

    it('rejects a module-form declaration file that would break the global output', async () => {
      // `export {}` + `declare global` is a common authoring style, but
      // concatenating it verbatim would turn the whole output into a module
      // and silently strip the globals of their global meaning.
      const srcDir = writeFiles({
        'global.d.ts':
          'export {};\ndeclare global {\n  interface Bar {\n    baz: string;\n  }\n}\n',
        'index.ts': 'export const noop = () => undefined;\n',
      });

      await assert.rejects(
        () =>
          build({
            entries: [{ name: 'test', filename: path.join(srcDir, 'index.ts') }],
            output: { filename: path.join(tmpDir, 'dist', 'types.d.ts') },
            tsconfig: path.resolve(process.cwd(), 'tsconfig.json'),
            additionalDeclarations: [path.join(srcDir, 'global.d.ts')],
          }),
        { message: /is a module and cannot be concatenated/ },
      );
    });

    it('accepts a module-form declaration file when marked emit: false', async () => {
      const srcDir = writeFiles({
        'global.d.ts': 'export {};\ndeclare global {\n  var appGlobals: { flag: boolean };\n}\n',
        'index.ts': 'export const getFlag = () => appGlobals.flag;\n',
      });
      const outputPath = path.join(tmpDir, 'dist', 'types.d.ts');

      await build({
        entries: [{ name: 'test', filename: path.join(srcDir, 'index.ts') }],
        output: { filename: outputPath },
        tsconfig: path.resolve(process.cwd(), 'tsconfig.json'),
        additionalDeclarations: [{ filename: path.join(srcDir, 'global.d.ts'), emit: false }],
      });

      const dts = fs.readFileSync(outputPath, 'utf-8');
      assert.match(dts, /getFlag: \(\) => boolean/, 'declare global should still feed typing');
      assert.doesNotMatch(dts, /declare global/);
      assert.doesNotMatch(dts, /export \{\};/m);
    });

    it('fails loudly on a missing file, including in emit: false mode', async () => {
      const srcDir = writeFiles({ 'index.ts': 'export const x = 1;\n' });
      const missing = path.join(srcDir, 'nonexistent.d.ts');

      for (const decl of [missing, { filename: missing, emit: false as const }]) {
        await assert.rejects(
          () =>
            build({
              entries: [{ name: 'test', filename: path.join(srcDir, 'index.ts') }],
              output: { filename: path.join(tmpDir, 'dist', 'types.d.ts') },
              tsconfig: path.resolve(process.cwd(), 'tsconfig.json'),
              additionalDeclarations: [decl],
            }),
          { message: /Source file not found/ },
        );
      }
    });
  });
});
