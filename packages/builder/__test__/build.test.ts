import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import ts from 'typescript';
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

/**
 * Type-check a consumer `.ts` snippet against a generated `.d.ts`, to prove the
 * declaration behaves as intended (e.g. a global augmentation actually applies)
 * rather than merely matching the expected text. Returns the semantic errors.
 */
function typeCheckConsumer(generatedDts: string, consumerTs: string): string[] {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-remote-consumer-'));
  const dtsPath = path.join(dir, 'my-app.d.ts');
  const consumerPath = path.join(dir, 'consumer.ts');
  fs.writeFileSync(dtsPath, generatedDts);
  fs.writeFileSync(consumerPath, consumerTs);

  try {
    const program = ts.createProgram([dtsPath, consumerPath], {
      target: ts.ScriptTarget.ES2020,
      lib: ['lib.es2020.d.ts', 'lib.dom.d.ts'],
      moduleResolution: ts.ModuleResolutionKind.Node10,
      strict: true,
      noEmit: true,
      types: [],
    });

    return ts
      .getPreEmitDiagnostics(program)
      .filter((d) => d.file?.fileName === consumerPath)
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
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

  describe('inline `declare global` in an entry module', () => {
    // Unlike an external .d.ts (see additionalDeclarations), a `declare global`
    // block written directly inside an entry module goes through the emitter and
    // is preserved as a `global {}` augmentation inside the module block — which
    // is valid ambient syntax and applies globally on the consumer side. These
    // tests pin that behavior so a future emitter change can't silently drop it.

    // A self-contained global (`declare global { var ... }`) rather than a DOM
    // `Window` augmentation, so the fixture doesn't depend on `lib.dom` being in
    // the build's tsconfig (it isn't).
    const globalEntry =
      'interface Bar { baz: string; }\n' +
      'declare global {\n  var appBar: Bar;\n}\n' +
      'export const getBar = () => appBar;\n';

    async function buildGlobalEntry(): Promise<string> {
      const srcDir = writeFiles({ 'index.ts': globalEntry });
      const outputPath = path.join(tmpDir, 'dist', 'types.d.ts');

      await build({
        entries: [{ name: 'my-app', filename: path.join(srcDir, 'index.ts') }],
        output: { filename: outputPath },
        tsconfig: path.resolve(process.cwd(), 'tsconfig.json'),
      });

      return fs.readFileSync(outputPath, 'utf-8');
    }

    it('preserves `declare global` as a `global {}` block inside the module', async () => {
      const dts = await buildGlobalEntry();

      assert.match(dts, /declare module "my-app"/, 'module block should be present');
      assert.match(
        dts,
        /\bglobal\s*\{/,
        'the augmentation should be emitted as a `global {}` block',
      );
      assert.match(dts, /var appBar: Bar/, 'the global declaration must be shipped');
      assert.match(dts, /getBar: \(\) => Bar/, 'emitted types should resolve the local Bar');

      // The `global` block must sit INSIDE the module block, not at top level:
      // a top-level `global {}` is only legal inside an ambient module.
      assert.ok(
        dts.indexOf('declare module "my-app"') < dts.indexOf('global {'),
        'the `global {}` block should be nested inside the module block',
      );
    });

    it('produces a .d.ts where the global augmentation applies on the consumer side', async () => {
      const dts = await buildGlobalEntry();

      const okErrors = typeCheckConsumer(
        dts,
        `/// <reference path="./my-app.d.ts" />\nconst f: { baz: string } = appBar;\nexport { f };\n`,
      );
      assert.deepEqual(okErrors, [], 'appBar should type-check via the global augmentation');

      // Negative control: the global is typed precisely, not a blanket `any`.
      const badErrors = typeCheckConsumer(
        dts,
        `/// <reference path="./my-app.d.ts" />\nconst n: number = appBar.baz;\nexport { n };\n`,
      );
      assert.ok(
        badErrors.some((e) => /not assignable/.test(e)),
        'appBar.baz (a string) should not be assignable to number',
      );
    });

    it('does not emit a bare top-level `global {}` block', async () => {
      const dts = await buildGlobalEntry();

      // No `global {` may appear before the opening module block — i.e. none
      // escapes to the top level, where it would be invalid ambient syntax.
      assert.ok(
        dts.indexOf('global {') > dts.indexOf('declare module "my-app"'),
        'no `global {}` should escape to the top level',
      );
    });
  });
});
