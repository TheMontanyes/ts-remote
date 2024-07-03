import ts from 'typescript';
import path from 'node:path';

export const getCompilerOptions = (pathToTSConfig?: string): ts.CompilerOptions => {
  try {
    if (!pathToTSConfig) throw new Error();

    const { config } = ts.readConfigFile(pathToTSConfig, ts.sys.readFile);

    let { options: compilerOptions } = ts.convertCompilerOptionsFromJson(
      config.compilerOptions,
      '',
    );

    if (config.extends) {
      const extendConfigPath = path.relative(path.dirname(pathToTSConfig), config.extends);

      compilerOptions = {
        ...compilerOptions,
        ...getCompilerOptions(extendConfigPath),
      };
    }

    return compilerOptions;
  } catch (e) {
    throw new Error(
      `ts-remote: [ERROR] Error reading tsconfig.json. Check the specified path or the validity of the file.\n
      ${e}`,
    );
  }
};
