import path from 'node:path';
import process from 'node:process';
import ts from 'typescript';
import { BuilderOptions, DeclarationVariant, ModuleName } from './contract-public';
import { validateExtension } from './validate-extension';
import { getCompilerOptions } from './get-compiler-options';
import { Emitter } from './emitter';
import {
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
    [...entryFiles, ...additionalDeclarations],
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
  const finalCode = modulesContent.join(ts.sys.newLine);
  const cleanedCode = removeDeclareInAmbientContext(finalCode);

  ts.sys.writeFile(outputPath, await outputFormat(cleanedCode), true);
}
