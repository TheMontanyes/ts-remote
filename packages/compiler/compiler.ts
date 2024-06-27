import path from 'node:path';
import ts from 'typescript';
import { createParser } from './parser';
import { CompilerOptions } from './types';
import { printModule } from './printer';
import { getCompilerOptions, isFromStdLib } from '../lib';

const cwd = process.cwd();

const baseOutputPath = path.resolve(cwd, '@types', 'types.d.ts');
const baseOutputFormat = (result: string) => result;
const baseTsConfigPath = path.resolve(cwd, 'tsconfig.json');

export default async function main({
  moduleList,
  output = { filename: baseOutputPath, format: baseOutputFormat },
  tsconfig,
  additionalDeclarations = [],
}: CompilerOptions) {
  const compilerOptions = getCompilerOptions(tsconfig || baseTsConfigPath);
  const exposeEntries = Object.entries(moduleList);

  const program = ts.createProgram(
    exposeEntries.map(([_, fileName]) => fileName),
    {
      ...compilerOptions,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      declaration: true,
      emitDeclarationOnly: true,
      noEmit: true,
    },
  );

  const parser = createParser(program);

  let resultSourceCodeDTS = exposeEntries.reduce((acc, [moduleName, fileName]) => {
    const sourceFile = program.getSourceFile(fileName);

    if (sourceFile) {
      const parsedModule = parser(sourceFile);
      const moduleText = printModule({ moduleName, parsedModule, options: { output } });

      acc += moduleText;
      acc += ts.sys.newLine;
    } else {
      throw new Error(`Not found file at - ${fileName}`);
    }

    return acc;
  }, '');

  if (resultSourceCodeDTS) {
    if (additionalDeclarations.length > 0) {
      let additionalCode = '';

      additionalDeclarations.forEach((fileName) => {
        additionalCode += ts.sys.readFile(fileName, 'utf8');
        additionalCode += ts.sys.newLine;
      });

      resultSourceCodeDTS = `${additionalCode}${resultSourceCodeDTS}`;
    }

    ts.sys.writeFile(
      output?.filename || baseOutputPath,
      (output?.format || baseOutputFormat)(resultSourceCodeDTS),
    );
  }
}
