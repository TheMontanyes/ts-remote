import ts from 'typescript';
import path from 'node:path';
import { BuilderError } from '../shared/errors';

/**
 * Read `compilerOptions` from a tsconfig file, apply `override` on top, and
 * return the resolved options.
 *
 * `extends` chains, `${configDir}` and value validation are handled by
 * TypeScript's own parser. Both read errors (missing file, malformed JSON) and
 * parse errors (bad `extends` target, invalid option values) are surfaced as a
 * `BuilderError` rather than being swallowed — a silently empty options object
 * would drop `strict`/`lib`/etc. and quietly degrade the emitted types.
 */
export const getCompilerOptions = (
  pathToTSConfig?: string,
  override: ts.CompilerOptions = {},
): ts.CompilerOptions => {
  if (!pathToTSConfig) {
    throw new BuilderError('No tsconfig path provided');
  }

  const basePath = path.dirname(pathToTSConfig);

  const { config, error } = ts.readConfigFile(pathToTSConfig, ts.sys.readFile);

  if (error) {
    throw new BuilderError(
      `Failed to read tsconfig at ${pathToTSConfig}: ${ts.flattenDiagnosticMessageText(
        error.messageText,
        '\n',
      )}`,
      { path: pathToTSConfig, diagnostic: error },
    );
  }

  const parsedConfig = ts.parseJsonConfigFileContent(
    config,
    ts.sys,
    basePath,
    undefined,
    pathToTSConfig,
  );

  // TS18003 ("No inputs were found") is irrelevant here: we only read
  // compilerOptions and pass the entry files to the program ourselves, so a
  // tsconfig whose include/files don't match must not fail the build.
  const NO_INPUTS_FOUND = 18003;
  const errors = parsedConfig.errors.filter((d) => d.code !== NO_INPUTS_FOUND);

  if (errors.length > 0) {
    const messages = errors
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))
      .join('\n');

    throw new BuilderError(`Invalid tsconfig at ${pathToTSConfig}:\n${messages}`, {
      path: pathToTSConfig,
      diagnostics: errors,
    });
  }

  return {
    ...parsedConfig.options,
    ...override,
  };
};
