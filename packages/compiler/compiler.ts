import path from 'node:path';
import ts from 'typescript';
import { createParser } from './parser';
import { CompileOptions } from './types';
import { printModule } from './printer';
import { getCompilerOptions, isFromStdLib } from './lib';

const cwd = process.cwd();

const baseOutputPath = path.resolve(cwd, '@types', 'types.d.ts');
const baseOutputFormat = (result: string) => result;
const baseTsConfigPath = path.resolve(cwd, 'tsconfig.json');

export default async function main({
  moduleList,
  output,
  tsconfig,
  additionalDeclarations = [],
}: CompileOptions) {
  const compilerOptions = getCompilerOptions(tsconfig || baseTsConfigPath);
  const exposeEntries = Object.entries(moduleList);

  const program = ts.createProgram(
    exposeEntries.map(([_, fileName]) => fileName),
    {
      declaration: true,
      emitDeclarationOnly: true,
      noEmit: true,
      paths: compilerOptions.paths,
      baseUrl: compilerOptions.baseUrl,
    },
  );

  const typeChecker = program.getTypeChecker();

  const stdLibTypes = program.getSourceFiles().reduce((acc, sourceFile) => {
    sourceFile.forEachChild((node) => {
      if (
        isFromStdLib(node) &&
        (ts.isTypeAliasDeclaration(node) ||
          ts.isInterfaceDeclaration(node) ||
          ts.isEnumDeclaration(node))
      ) {
        if (node.name) {
          acc.add(node.name.getText());
        }
      }
    });
    return acc;
  }, new Set<string>());

  const parser = createParser(typeChecker, stdLibTypes);

  let resultSourceCodeDTS = exposeEntries.reduce((acc, [moduleName, fileName]) => {
    const sourceFile = program.getSourceFile(fileName);

    if (sourceFile) {
      const parsedFile = parser(sourceFile);

      acc += `${printModule(moduleName, parsedFile)}${ts.sys.newLine}`;
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
