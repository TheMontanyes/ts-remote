import path from 'node:path';
import process from 'node:process';
import ts from 'typescript';
import { BuilderOptions, DeclarationVariant, ModuleName } from './contract-public';
import { validateExtension } from './validate-extension';
import { getCompilerOptions } from './get-compiler-options';
import { Emitter } from './emitter';
import {
  BuilderError,
  DuplicateFilenameError,
  DuplicateModuleError,
  EmitFailedError,
  SourceFileNotFoundError,
} from '../shared/errors';
import { removeDeclareInAmbientContext } from './utils';

const cwd = process.cwd();
const baseOutputPath = path.resolve(cwd, '@types', 'types.d.ts');
const baseOutputFormat = (result: string) => result;
const baseTsConfigPath = path.resolve(cwd, 'tsconfig.json');

export default async function main(options: BuilderOptions) {
  const { entries, output, tsconfig, additionalDeclarations = [] } = options;
  const config = tsconfig || baseTsConfigPath;
  const outputFormat = output?.format || baseOutputFormat;
  const outputPath = output?.filename || baseOutputPath;

  const additional = additionalDeclarations.map((decl) =>
    typeof decl === 'string'
      ? { filename: decl, emit: true }
      : { filename: decl.filename, emit: decl.emit ?? true },
  );

  // Validate and read additional declarations up front — a missing file must
  // fail loudly even in emit:false mode, where the compiler would otherwise
  // silently type against an environment that isn't there.
  const globalsContent: string[] = [];

  for (const { filename, emit } of additional) {
    if (!filename.endsWith('.d.ts')) {
      throw new BuilderError(
        `additionalDeclarations must be .d.ts files, got: ${filename}. ` +
          'Source files belong in "entries".',
      );
    }

    const text = ts.sys.readFile(filename);

    if (text === undefined) {
      throw new SourceFileNotFoundError(filename);
    }

    if (!emit) {
      continue;
    }

    // A module-form file (top-level import/export, e.g. `export {}` with
    // `declare global`) would turn the whole concatenated output into a
    // module and strip its globals of their global meaning.
    const parsed = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true);

    if (ts.isExternalModule(parsed)) {
      throw new BuilderError(
        `additionalDeclarations file is a module and cannot be concatenated into the output: ${filename}. ` +
          'Declare the globals at top level without import/export (script form), ' +
          'or mark the file { emit: false } to keep it environment-only.',
      );
    }

    globalsContent.push(text.replace(/^\uFEFF/, '').trimEnd());
  }

  const compilerOptions: ts.CompilerOptions = getCompilerOptions(config, {
    outDir: undefined,
    outFile: undefined,
    noEmit: undefined,
    allowJs: true,
    declaration: true,
    emitDeclarationOnly: true,
    skipLibCheck: true,
    // We bundle the declarations into a single ambient module ourselves, so any
    // source maps the consumer's tsconfig (or TS defaults) would emit are
    // meaningless and would only leak `.d.ts.map` / `sourceMappingURL` noise.
    declarationMap: false,
    sourceMap: false,
    inlineSourceMap: false,
    inlineSources: false,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    module: ts.ModuleKind.CommonJS,
  });

  const { entryFiles, moduleByFilename, variantByModule } = entries.reduce(
    (acc, { name, filename, variant }) => {
      if (validateExtension(filename)) {
        acc.entryFiles.push(filename);
      }

      if (acc.moduleByFilename.has(filename)) {
        throw new DuplicateFilenameError(filename);
      }

      if (acc.variantByModule.has(name)) {
        throw new DuplicateModuleError(name);
      }

      acc.moduleByFilename.set(filename, name);
      acc.variantByModule.set(name, variant ?? DeclarationVariant.Module);

      return acc;
    },
    {
      entryFiles: [] as string[],
      moduleByFilename: new Map<string, ModuleName>(),
      variantByModule: new Map<ModuleName, DeclarationVariant>(),
    },
  );

  const compilerHost = ts.createCompilerHost(compilerOptions);
  const program = ts.createProgram(
    [...entryFiles, ...additional.map((d) => d.filename)],
    compilerOptions,
    compilerHost,
  );

  const moduleResolutionCache = ts.createModuleResolutionCache(
    compilerHost.getCurrentDirectory(),
    compilerHost.getCanonicalFileName,
    compilerOptions,
  );

  const firstSourceFile = program.getSourceFile(entryFiles[0]);
  if (!firstSourceFile) {
    throw new SourceFileNotFoundError(entryFiles[0]);
  }

  const sharedEmitter = new Emitter({
    compilerHost,
    program,
    rootFile: firstSourceFile,
    moduleResolutionCache,
    entryFileNames: moduleByFilename,
  });

  const modulesContent: string[] = [];

  entryFiles.forEach((fileName) => {
    const sourceFile = program.getSourceFile(fileName);
    const moduleName = moduleByFilename.get(fileName)!;
    const variant = variantByModule.get(moduleName)!;

    if (sourceFile) {
      sharedEmitter.setRootFile(sourceFile);
      const emitResult = sharedEmitter.emit(sourceFile);

      if (!emitResult) {
        throw new EmitFailedError(fileName);
      }

      switch (variant) {
        case DeclarationVariant.Namespace:
          modulesContent.push(
            `declare namespace ${moduleName} {${ts.sys.newLine}${emitResult.outputText}}${ts.sys.newLine}`,
          );
          break;
        case DeclarationVariant.Module:
        default:
          modulesContent.push(
            `declare module "${moduleName}" {${ts.sys.newLine}${emitResult.outputText}}${ts.sys.newLine}`,
          );
      }

      sharedEmitter.resetBuffers();
    }
  });

  sharedEmitter.dispose();

  // Combine all modules and remove redundant 'declare' modifiers inside ambient contexts
  const modulesCode = removeDeclareInAmbientContext(modulesContent.join(ts.sys.newLine));

  // Emitted additional declarations go verbatim before the module blocks:
  // they must stay top-level (and keep their `declare` modifiers) so the
  // consumer's global scope picks them up.
  const finalCode = [...globalsContent, modulesCode].join(ts.sys.newLine);

  ts.sys.writeFile(outputPath, await outputFormat(finalCode), true);
}
