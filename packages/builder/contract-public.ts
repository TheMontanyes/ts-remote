export type ImportPath = string;
export type ModuleName = string;
export enum DeclarationVariant {
  Module,
  Namespace,
}

/**
 * Represents a single module declaration entry.
 *
 * A declaration entry defines a module name and its source file,
 * along with an optional variant (Module or Namespace).
 *
 * @example
 * ```typescript
 * // Module variant (default)
 * const moduleEntry: DeclarationEntry = {
 *   name: 'my-app',
 *   filename: './src/index.ts'
 * };
 *
 * // Namespace variant
 * const namespaceEntry: DeclarationEntry = {
 *   name: 'Utils',
 *   filename: './src/utils.ts',
 *   variant: DeclarationVariant.Namespace
 * };
 * ```
 */
export type DeclarationEntry = {
  name: ModuleName;
  filename: ImportPath;
  variant?: DeclarationVariant;
};

/**
 * An additional `.d.ts` file for the build.
 *
 * A plain string (or `emit: true`, the default) makes the file part of the
 * compilation environment AND concatenates its content verbatim into the
 * generated output — use this for global declarations (e.g. `interface Window`
 * augmentations) that the emitted types reference, so consumers receive them.
 *
 * `emit: false` makes the file environment-only: visible to the compiler
 * while generating declarations, but not shipped in the output.
 */
export type AdditionalDeclaration =
  | ImportPath
  | {
      /** Path to the `.d.ts` file */
      filename: ImportPath;
      /**
       * Include the file's content in the generated output.
       * @default true
       */
      emit?: boolean;
    };

export type BuilderOptions = {
  /**
   * Array of module declarations to compile.
   *
   * Each entry defines a module name and its source file.
   * The builder will process all entries and generate type declarations for each.
   *
   * @example
   * ```typescript
   * entries: [
   *   { name: 'app', filename: './src/app.ts' },
   *   { name: 'utils', filename: './src/utils.ts', variant: DeclarationVariant.Namespace },
   * ]
   * ```
   */
  entries: DeclarationEntry[];
  /**
   * `.d.ts` files required for the compilation environment and (unless
   * `emit: false`) concatenated into the generated output.
   * */
  additionalDeclarations?: AdditionalDeclaration[];
  output?: {
    /**
     * The path to the compiled file
     * @default path.resolve(process.cwd(), '@types', 'types.d.ts')
     * */
    filename?: string;
    /**
     * A method for processing the contents of a compiled file
     * */
    format?: (result: string) => string | Promise<string>;
  };
  /**
   * The path to tsconfig
   * @default path.resolve(process.cwd(), 'tsconfig.json')
   * */
  tsconfig?: string;
};
