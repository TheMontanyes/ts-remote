import fs from 'node:fs';
import path from 'node:path';
import ts, { ModuleKind, ModuleResolutionKind, ScriptTarget } from 'typescript';
import { getCompilerOptions } from '../packages/builder/get-compiler-options';

const cwd = process.cwd();
const OUTPUT_DIR = 'dist';
const OUTPUT_PATH = path.resolve(cwd, OUTPUT_DIR);

const PUBLISH_FIELDS = [
  'name',
  'version',
  'description',
  'keywords',
  'bin',
  'exports',
  'repository',
  'author',
  'license',
  'bugs',
  'homepage',
  'peerDependencies',
] as const;

const FILES_TO_COPY = ['LICENSE', 'README.md'] as const;

// 1. Clean output directory
if (fs.existsSync(OUTPUT_PATH)) {
  fs.rmSync(OUTPUT_PATH, { force: true, recursive: true });
}

console.log('Building ts-remote...');

// 2. Compile TypeScript
const entryFiles = [
  ts.sys.resolvePath(`${cwd}/packages/builder/index.ts`),
  ts.sys.resolvePath(`${cwd}/packages/fetcher/index.ts`),
  ts.sys.resolvePath(`${cwd}/packages/plugin/index.ts`),
  ts.sys.resolvePath(`${cwd}/packages/cli/index.ts`),
];

const program = ts.createProgram(entryFiles, {
  ...getCompilerOptions(path.resolve(cwd, 'tsconfig.json')),
  module: ModuleKind.CommonJS,
  // Emit `.d.ts` alongside `.js`. Kept here (not in the shared tsconfig) so the
  // root config stays emit-free for typecheck / ts-node, which under TS 6.0
  // errors (TS5011) when `declaration` is on without an explicit rootDir.
  declaration: true,
  outDir: OUTPUT_PATH,
  // Emit packages/<pkg>/... as dist/<pkg>/... so the published `exports`
  // (./builder, ./fetcher, ./plugin) and the bin wrapper (../cli/index.js)
  // resolve. Without an explicit rootDir TS infers the common source dir, which
  // shifts once non-packages files (scripts/, examples/) enter the program.
  rootDir: path.resolve(cwd, 'packages'),
  target: ScriptTarget.ESNext,
  moduleResolution: ModuleResolutionKind.Node10,
  // TS 6.0 deprecates the legacy `node10` resolver (removed in 7.0). The CJS
  // output still relies on it, so silence the deprecation until we migrate.
  ignoreDeprecations: '6.0',
});

const emitResult = program.emit();
const diagnostics = ts.getPreEmitDiagnostics(program).concat(emitResult.diagnostics);

if (diagnostics.length > 0) {
  console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: (f) => f,
    getCurrentDirectory: () => cwd,
    getNewLine: () => ts.sys.newLine,
  }));
  process.exit(1);
}

console.log('  Compiled TypeScript');

// 3. Create bin entry point
const binDir = path.resolve(OUTPUT_PATH, 'bin');
fs.mkdirSync(binDir, { recursive: true });
const binPath = path.resolve(binDir, 'ts-remote.js');
fs.writeFileSync(binPath, '#!/usr/bin/env node\nrequire("../cli/index.js");\n');
fs.chmodSync(binPath, 0o755);
console.log('  Created bin/ts-remote.js');

// 4. Build dist/package.json (whitelist approach)
const sourcePackage = JSON.parse(fs.readFileSync(path.resolve(cwd, 'package.json'), 'utf-8'));
const distPackage: Record<string, unknown> = {};

for (const field of PUBLISH_FIELDS) {
  if (field in sourcePackage) {
    distPackage[field] = sourcePackage[field];
  }
}

distPackage['scripts'] = {};
fs.writeFileSync(path.resolve(OUTPUT_PATH, 'package.json'), JSON.stringify(distPackage, null, 2) + '\n');
console.log('  Generated package.json');

// 5. Copy static files
for (const fileName of FILES_TO_COPY) {
  fs.cpSync(path.resolve(cwd, fileName), path.resolve(OUTPUT_PATH, fileName));
}

console.log('  Copied LICENSE, README.md');
console.log('Done');
