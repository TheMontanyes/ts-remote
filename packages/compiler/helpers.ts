import ts from 'typescript';
import path from 'node:path';
import merge from 'lodash.merge';
import fs from 'fs';

export const isNodeFromPackage = (node: ts.Node) => {
  return node.getSourceFile().fileName.includes('node_modules');
};

export const isFromStdLib = (node: ts.Node) => {
  const sourceFile = node.getSourceFile();

  if (sourceFile) {
    const libFolderName = '/typescript/lib'; // путь к стандартной библиотеке TypeScript
    return sourceFile.fileName.includes(libFolderName);
  }

  return false;
};

export const createRegexpIdentifier = (identifier: string) =>
  new RegExp(`(?<![.'"])\\b${identifier}\\b(?!['":?])`, 'gm');

export const replaceImport = (text: string) =>
  text.replace(
    /import\(['"](?:(?!node_modules).)*?['"]\)\.?|(?<=import\(['"]).*?node_modules\/@types\/((?:(?!(?:['"\/\)])).)*)(?:(?!['"]\)).)*|(?<=import\(['"]).*?node_modules\/((?:.(?!(?:index|['"\)])))*[^\/])(?:(?!['"]\)).)*/gm,
    '$1$2',
  );

type JSDoc = { jsDoc: ts.JSDoc[] };

const hasJsDOC = <N extends ts.Node>(node: N & Partial<JSDoc>): node is N & JSDoc =>
  Boolean(node.jsDoc && node.jsDoc.length > 0);

const extractJSDocFromNode = <N extends ts.Node & JSDoc>(node: N) => node.jsDoc[0].getFullText();

export const getJsDOC = <N extends ts.Node>(node: N) => {
  if (
    ts.isVariableDeclaration(node) &&
    ts.isVariableDeclarationList(node.parent) &&
    hasJsDOC(node.parent.parent)
  ) {
    // get jsDoc from variable statement
    return extractJSDocFromNode(node.parent.parent);
  }

  if (hasJsDOC(node)) {
    return extractJSDocFromNode(node);
  }

  return '';
};

const getTsConfig = (pathToTSConfig: string) => {
  try {
    return JSON.parse(fs.readFileSync(pathToTSConfig).toString('utf8'));
  } catch (e) {
    console.log(e);
    throw new Error(
      `ts-federation: [ERROR] Error reading tsconfig.json. Check the specified path or the validity of the file.\n
      ${e}`,
    );
  }
};

export const getCompilerOptions = (pathToTSConfig?: string): ts.CompilerOptions => {
  try {
    if (!pathToTSConfig) throw new Error();

    const config = getTsConfig(pathToTSConfig);

    let compilerOptions: ts.CompilerOptions = config.compilerOptions;

    if (config.extends) {
      const extendConfigPath = path.resolve(path.dirname(pathToTSConfig), config.extends);

      compilerOptions = merge(
        compilerOptions,
        getCompilerOptions(extendConfigPath),
      ) as ts.CompilerOptions;
    }

    if (compilerOptions.baseUrl) {
      compilerOptions.baseUrl = path.resolve(path.dirname(pathToTSConfig), compilerOptions.baseUrl);
    }

    return {
      ...compilerOptions,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      noEmit: true,
      declaration: true,
      esModuleInterop: true,
      emitDeclarationOnly: true,
    };
  } catch (e) {
    throw new Error(
      `ts-federation: [ERROR] Error reading tsconfig.json. Check the specified path or the validity of the file.\n
      ${e}`,
    );
  }
};
