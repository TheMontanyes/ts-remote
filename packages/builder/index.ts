/**
 * Builds TypeScript declaration files from source files.
 *
 * Creates a consolidated `.d.ts` file containing type declarations
 * for all specified entry modules. Useful for sharing types between
 * independently deployed applications (e.g., microfrontends).
 *
 * @example
 * Basic usage:
 * ```typescript
 * import build from 'ts-remote/builder';
 *
 * await build({
 *   entries: [
 *     { name: 'my-app', filename: './src/index.ts' },
 *   ],
 *   output: {
 *     filename: './dist/types.d.ts',
 *   },
 * });
 * ```
 *
 * @example
 * With namespace variant:
 * ```typescript
 * import build, { DeclarationVariant } from 'ts-remote/builder';
 *
 * await build({
 *   entries: [
 *     {
 *       name: 'MyApp',
 *       filename: './src/index.ts',
 *       variant: DeclarationVariant.Namespace
 *     },
 *   ],
 * });
 * ```
 *
 * @module ts-remote/builder
 */

export { default } from './build';
export { DeclarationVariant } from './contract-public';
export type {
  AdditionalDeclaration,
  BuilderOptions,
  DeclarationEntry,
  ModuleName,
  ImportPath,
} from './contract-public';
