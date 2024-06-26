import fs from 'node:fs';
import path from 'node:path';
import ts, { ModuleKind, ModuleResolutionKind, ScriptTarget } from 'typescript';
import { getCompilerOptions } from '../packages/lib';

const cwd = process.cwd();

const FILES_TO_COPY = ['package.json', 'LICENSE', 'README.md'] as const;
const OUTPUT_DIR = 'dist';
const OUTPUT_PATH = `${path.resolve(cwd, OUTPUT_DIR)}`;

if (fs.existsSync(OUTPUT_PATH)) {
  fs.rmSync(OUTPUT_PATH, { force: true, recursive: true });
}

const program = ts.createProgram(
  [
    ts.sys.resolvePath(`${cwd}/packages/compiler/index.ts`),
    ts.sys.resolvePath(`${cwd}/packages/loader/index.ts`),
  ],
  {
    ...getCompilerOptions(path.resolve(cwd, 'tsconfig.json')),
    module: ModuleKind.CommonJS,
    outDir: OUTPUT_PATH,
    target: ScriptTarget.ESNext,
    moduleResolution: ModuleResolutionKind.Node10,
  },
);

program.emit();

FILES_TO_COPY.forEach((fileName) => {
  fs.cpSync(path.resolve(cwd, fileName), `${path.resolve(cwd, OUTPUT_PATH, fileName)}`);
});
