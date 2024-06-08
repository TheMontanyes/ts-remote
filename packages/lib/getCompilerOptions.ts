import ts from 'typescript';
import path from 'node:path';
import merge from 'lodash.merge';
import fs from 'fs';

const getTsConfig = (pathToTSConfig: string) => {
  try {
    return JSON.parse(fs.readFileSync(pathToTSConfig).toString('utf8'));
  } catch (e) {
    throw new Error(
      `ts-remote: [ERROR] Error reading tsconfig.json. Check the specified path or the validity of the file.\n
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

    return compilerOptions;
  } catch (e) {
    throw new Error(
      `ts-remote: [ERROR] Error reading tsconfig.json. Check the specified path or the validity of the file.\n
      ${e}`,
    );
  }
};
