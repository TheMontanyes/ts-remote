import ts from 'typescript';
import { canHaveName } from './helpers';

type EmitterOptions = {
  rootFile: ts.SourceFile;
  program: ts.Program;
  compilerHost: ts.CompilerHost;
  moduleResolutionCache?: ts.ModuleResolutionCache;
  entryFileNames?: Map<string, string>;
};

export class Emitter {
  #program: ts.Program;
  #typeChecker: ts.TypeChecker;
  #compilerOptions: ts.CompilerOptions;
  #compilerHost: ts.CompilerHost;
  #printer: ts.Printer;
  #moduleResolutionCache: ts.ModuleResolutionCache;
  #rootFile: ts.SourceFile;
  #aliasImportMap = new Map<string, string>();
  #emittedFiles = new Set<string>();
  #visitedCache = new WeakSet<ts.Node>();
  #declarationParts: string[] = [];
  #imports: string[] = [];
  #exports: string[] = [];
  #entryFileNames: Map<string, string>;
  // Name collision tracking
  #exportedNames = new Set<string>();
  #nameCollisions = new Map<ts.Node, string>(); // Maps internal nodes to their renamed versions
  #nameCounter = new Map<string, number>(); // Tracks collision counters for each name

  constructor({
    program,
    compilerHost,
    rootFile,
    moduleResolutionCache,
    entryFileNames,
  }: EmitterOptions) {
    this.#program = program;
    this.#printer = ts.createPrinter();
    this.#typeChecker = program.getTypeChecker();
    this.#compilerOptions = program.getCompilerOptions();
    this.#compilerHost = compilerHost;
    this.#rootFile = rootFile;
    this.#entryFileNames = entryFileNames ?? new Map();
    this.#moduleResolutionCache =
      moduleResolutionCache ??
      ts.createModuleResolutionCache(
        compilerHost.getCurrentDirectory(),
        compilerHost.getCanonicalFileName,
        this.#compilerOptions,
      );
  }

  setRootFile(rootFile: ts.SourceFile): void {
    this.#rootFile = rootFile;
    // Clear collision state when switching to a new root file
    this.#exportedNames.clear();
    this.#nameCollisions.clear();
    this.#nameCounter.clear();
  }

  resetBuffers(): void {
    this.#declarationParts = [];
    this.#imports = [];
    this.#exports = [];
    // Don't clear #exportedNames, #nameCollisions, #nameCounter here
    // They should persist during the processing of a single module
  }

  /**
   * Generate a unique name for a collision
   */
  private generateUniqueName(baseName: string): string {
    const counter = this.#nameCounter.get(baseName) || 1;
    this.#nameCounter.set(baseName, counter + 1);
    return `${baseName}_${counter}`;
  }

  /**
   * Check if a name is exported from the root file
   */
  private isExportedName(name: string): boolean {
    return this.#exportedNames.has(name);
  }

  /**
   * Register an exported name from the root file
   */
  private registerExportedName(name: string): void {
    this.#exportedNames.add(name);
  }

  /**
   * Get the renamed version of a node if it exists
   */
  private getRenamedNode(node: ts.Node): string | undefined {
    return this.#nameCollisions.get(node);
  }

  /**
   * Register a collision and return the new name
   */
  private registerCollision(node: ts.Node, originalName: string): string {
    const newName = this.generateUniqueName(originalName);
    this.#nameCollisions.set(node, newName);
    return newName;
  }

  private resolveModule(moduleName: string, containingFile: string) {
    return ts.resolveModuleName(
      moduleName,
      containingFile,
      this.#compilerOptions,
      this.#compilerHost,
      this.#moduleResolutionCache,
    ).resolvedModule;
  }

  private getModuleNameFromSpecifier(specifier: ts.Expression): string {
    if (ts.isStringLiteral(specifier)) {
      return specifier.text;
    }
    return specifier.getText().replace(/['"]/g, '');
  }

  private get declaration(): ts.TranspileOutput {
    const parts: string[] = [];

    if (this.#imports.length > 0) {
      parts.push(this.#imports.join(ts.sys.newLine), ts.sys.newLine);
    }

    parts.push(...this.#declarationParts);

    if (this.#exports.length > 0) {
      parts.push(ts.sys.newLine, this.#exports.join(ts.sys.newLine));
    }

    const code = parts.join('');
    return ts.transpileDeclaration(code, { compilerOptions: this.#compilerOptions });
  }

  private collectAliases(node: ts.ImportDeclaration) {
    const importClause = node.importClause;
    if (!importClause) return;

    if (importClause.namedBindings && ts.isNamedImports(importClause.namedBindings)) {
      for (let i = 0; i < importClause.namedBindings.elements.length; i++) {
        const element = importClause.namedBindings.elements[i];

        if (element.propertyName && element.name) {
          this.#aliasImportMap.set(element.name.text, element.propertyName.text);
        }
      }
    }

    if (importClause.namedBindings && ts.isNamespaceImport(importClause.namedBindings)) {
      const moduleName = (node.moduleSpecifier as ts.StringLiteral).text;
      this.#aliasImportMap.set(importClause.namedBindings.name.text, moduleName);
    }
  }

  private getStatementVisitor = (context: ts.TransformationContext) => {
    const visitor = (node: ts.Node): ts.Node => {
      if (ts.isLiteralTypeNode(node)) {
        if (ts.isStringLiteral(node.literal)) {
          return context.factory.createLiteralTypeNode(
            context.factory.createStringLiteral(node.literal.text),
          );
        }

        if (ts.isNumericLiteral(node.literal)) {
          return context.factory.createLiteralTypeNode(
            context.factory.createNumericLiteral(node.literal.text),
          );
        }

        if (
          node.literal.kind === ts.SyntaxKind.TrueKeyword ||
          node.literal.kind === ts.SyntaxKind.FalseKeyword
        ) {
          return context.factory.createLiteralTypeNode(
            node.literal.kind === ts.SyntaxKind.TrueKeyword
              ? context.factory.createTrue()
              : context.factory.createFalse(),
          );
        }
      }

      return ts.visitEachChild(node, visitor, context);
    };

    return visitor;
  };

  private updateStatements = (
    statements: ts.Statement[] | ts.NodeArray<ts.Statement>,
    visitor: ts.Visitor,
  ): ts.Statement[] => {
    return statements.map((statement) => ts.visitNode(statement, visitor)) as ts.Statement[];
  };

  /**
   * First pass: collect all exported names from the root file
   */
  private collectExportedNames(sourceFile: ts.SourceFile): void {
    const isRootFile = sourceFile.fileName === this.#rootFile.fileName;
    if (!isRootFile) return;

    const visit = (node: ts.Node): void => {
      // Collect names from export declarations
      if (ts.isExportDeclaration(node)) {
        if (node.exportClause && ts.isNamedExports(node.exportClause)) {
          for (const element of node.exportClause.elements) {
            this.registerExportedName(element.name.text);
          }
        }
      }

      // Collect names from exported statements
      if (ts.canHaveModifiers(node) && node.modifiers) {
        const hasExport = node.modifiers.some(
          (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
        );

        if (hasExport && canHaveName(node)) {
          this.registerExportedName(node.name.text);
        }
      }

      ts.forEachChild(node, visit);
    };

    ts.forEachChild(sourceFile, visit);
  }

  /**
   * Collect names exported from a file via a standalone `export { ... }`
   * declaration that has no module specifier (i.e. re-exporting local
   * declarations, not `export { x } from "..."`).
   *
   * These names belong to declarations defined in the same file using the
   * `class X {} ... export { X }` pattern, and must be exempt from the internal
   * name-collision renaming.
   */
  private collectLocalExportNames(sourceFile: ts.SourceFile): Set<string> {
    const names = new Set<string>();

    for (const statement of sourceFile.statements) {
      if (
        ts.isExportDeclaration(statement) &&
        !statement.moduleSpecifier &&
        statement.exportClause &&
        ts.isNamedExports(statement.exportClause)
      ) {
        for (const element of statement.exportClause.elements) {
          // Use the local name (propertyName when aliased: `export { Local as Public }`)
          const localName = element.propertyName?.text ?? element.name.text;
          names.add(localName);
        }
      }
    }

    return names;
  }

  private transformFile(
    sourceFile: ts.SourceFile,
    context: ts.TransformationContext,
  ): ts.SourceFile {
    const statementVisitor = this.getStatementVisitor(context);

    const isRootFile = sourceFile.fileName === this.#rootFile.fileName;

    // Names exported from this file via a standalone `export { X }` declaration
    // (no module specifier). Such declarations are the symbol's real export, so
    // the corresponding `class X {}` / `interface X {}` must NOT be treated as an
    // internal name collision and renamed.
    const locallyExportedNames = this.collectLocalExportNames(sourceFile);

    const exportsSpecifiers: ts.ExportSpecifier[] = [];
    const seenSpecifiers = new Set<string>();
    const namespaceExports: Array<{ name: string; sourceFile: ts.SourceFile }> = [];

    const hasSpecifier = (name: string) => seenSpecifiers.has(name);

    const addSpecifier = (specifier: ts.ExportSpecifier) => {
      seenSpecifiers.add(specifier.name.text);
      exportsSpecifiers.push(specifier);
    };

    const processNamedExportBindings = (
      exportClause: ts.NamedExportBindings,
      sourceFileContext?: ts.SourceFile,
    ) => {
      exportClause.forEachChild((node) => {
        if (ts.isExportSpecifier(node) && !hasSpecifier(node.name.text)) {
          const symbolAtLocation = this.#typeChecker.getSymbolAtLocation(node.name);

          if (symbolAtLocation) {
            const aliasedSymbol = this.#typeChecker.getAliasedSymbol(symbolAtLocation);

            if (aliasedSymbol) {
              // Check if this is a namespace import (import * as Name)
              // by checking if the aliased symbol is a module/namespace
              const isNamespaceImport =
                (aliasedSymbol.flags & ts.SymbolFlags.ValueModule) !== 0 ||
                (aliasedSymbol.flags & ts.SymbolFlags.NamespaceModule) !== 0;

              if (isNamespaceImport && aliasedSymbol.declarations?.[0]) {
                // This is a re-export of a namespace import: export { Utils } where Utils is from import * as Utils
                // We need to create a namespace declaration instead of a simple export specifier
                const namespaceDeclaration = aliasedSymbol.declarations[0];
                const namespaceSourceFile = namespaceDeclaration.getSourceFile();

                // Add export specifier for the namespace name
                addSpecifier(
                  context.factory.createExportSpecifier(node.isTypeOnly, undefined, node.name.text),
                );

                // Store namespace generation info to be processed later
                // We'll handle this similar to export * as Namespace
                namespaceExports.push({
                  name: node.name.text,
                  sourceFile: namespaceSourceFile,
                });
              } else {
                const isDifferentName = node.name.text !== aliasedSymbol.name;

                if (isDifferentName) {
                  addSpecifier(
                    context.factory.createExportSpecifier(
                      node.isTypeOnly,
                      aliasedSymbol.name,
                      node.name.text,
                    ),
                  );
                } else {
                  addSpecifier(node);
                }
              }
            }
          }
        }
      });
    };

    const visitor: ts.Visitor = (rootNode: ts.Node): ts.Node | undefined => {
      if (this.#visitedCache.has(rootNode)) {
        return rootNode;
      }

      this.#visitedCache.add(rootNode);

      if (ts.isExportAssignment(rootNode)) {
        if (isRootFile) {
          this.#exports.push(
            this.#printer.printNode(ts.EmitHint.Unspecified, rootNode, sourceFile),
          );
        }

        return;
      }

      if (
        ts.isImportEqualsDeclaration(rootNode) &&
        ts.isExternalModuleReference(rootNode.moduleReference)
      ) {
        const moduleName = this.getModuleNameFromSpecifier(rootNode.moduleReference.expression);
        const resolvedModule = this.resolveModule(moduleName, sourceFile.fileName);

        if (!resolvedModule || resolvedModule.isExternalLibraryImport) {
          this.#imports.push(
            this.#printer.printNode(ts.EmitHint.Unspecified, rootNode, sourceFile),
          );
          return;
        }

        this.#aliasImportMap.set(rootNode.name.text, moduleName);

        const symbolAtLocation = this.#typeChecker.getSymbolAtLocation(
          rootNode.moduleReference.expression,
        );

        if (symbolAtLocation?.declarations) {
          const [declaration] = symbolAtLocation.declarations;
          const module = declaration.getSourceFile();
          this.emit(module);
        }

        return;
      }

      if (ts.isImportDeclaration(rootNode) || ts.isExportDeclaration(rootNode)) {
        if (rootNode.moduleSpecifier) {
          const moduleName = this.getModuleNameFromSpecifier(rootNode.moduleSpecifier);
          const resolvedModule = this.resolveModule(moduleName, sourceFile.fileName);

          if (!resolvedModule || resolvedModule.isExternalLibraryImport) {
            if (ts.isImportDeclaration(rootNode)) {
              this.#imports.push(
                this.#printer.printNode(ts.EmitHint.Unspecified, rootNode, sourceFile),
              );
            }

            if (ts.isExportDeclaration(rootNode)) {
              this.#exports.unshift(
                this.#printer.printNode(ts.EmitHint.Unspecified, rootNode, sourceFile),
              );
            }

            return;
          }

          if (ts.isImportDeclaration(rootNode)) {
            this.collectAliases(rootNode);
          }

          const symbolAtLocation = this.#typeChecker.getSymbolAtLocation(rootNode.moduleSpecifier);

          if (symbolAtLocation?.declarations) {
            const [declaration] = symbolAtLocation.declarations;
            const module = declaration.getSourceFile();

            if (ts.isExportDeclaration(rootNode) && isRootFile) {
              if (rootNode.exportClause) {
                if (
                  // export * as {namespace} from ...
                  ts.isNamespaceExport(rootNode.exportClause) &&
                  !hasSpecifier(rootNode.exportClause.name.text)
                ) {
                  // export {namespaceName -> rootNode.exportClause.name.text}
                  addSpecifier(
                    context.factory.createExportSpecifier(
                      rootNode.isTypeOnly,
                      undefined,
                      rootNode.exportClause.name.text,
                    ),
                  );

                  // create namespace "rootNode.exportClause.name.text" {...}
                  return context.factory.createModuleDeclaration(
                    undefined,
                    context.factory.createIdentifier(rootNode.exportClause.name.text),
                    context.factory.createModuleBlock(
                      this.updateStatements(module.statements, statementVisitor),
                    ),
                    ts.NodeFlags.Namespace,
                  );
                }

                const namedEntryModuleName = this.#entryFileNames.get(module.fileName);

                if (namedEntryModuleName && ts.isNamedExports(rootNode.exportClause)) {
                  // Target is an entry-file — emit `export { ... } from "moduleName"`
                  const printedExport = this.#printer.printNode(
                    ts.EmitHint.Unspecified,
                    context.factory.createExportDeclaration(
                      undefined,
                      rootNode.isTypeOnly,
                      rootNode.exportClause,
                      context.factory.createStringLiteral(namedEntryModuleName),
                    ),
                    sourceFile,
                  );
                  this.#exports.push(printedExport);
                } else {
                  processNamedExportBindings(rootNode.exportClause);
                }
              } else {
                const entryModuleName = this.#entryFileNames.get(module.fileName);

                if (entryModuleName) {
                  // Target is an entry-file — emit `export * from "moduleName"`
                  this.#exports.push(`export * from "${entryModuleName}";`);
                } else {
                  const symbol = this.#typeChecker.getSymbolAtLocation(module);

                  if (symbol) {
                    const exportsOfModule = this.#typeChecker.getExportsOfModule(symbol);

                    for (const exportSymbol of exportsOfModule) {
                      if (!hasSpecifier(exportSymbol.name)) {
                        addSpecifier(
                          context.factory.createExportSpecifier(
                            rootNode.isTypeOnly,
                            undefined,
                            exportSymbol.name,
                          ),
                        );
                      }
                    }
                  }
                }
              }
            }

            this.emit(module);
          }
        } else if (ts.isExportDeclaration(rootNode) && isRootFile) {
          if (!rootNode.exportClause) {
            return;
          }

          processNamedExportBindings(rootNode.exportClause);
        }

        return;
      }

      if (ts.isClassDeclaration(rootNode)) {
        const members = context.factory.createNodeArray(
          rootNode.members.filter((member) => {
            // Filter out private/protected modifiers
            if (ts.canHaveModifiers(member) && member.modifiers) {
              const hasPrivateModifier = member.modifiers.some(
                (modifier) =>
                  modifier.kind === ts.SyntaxKind.PrivateKeyword ||
                  modifier.kind === ts.SyntaxKind.ProtectedKeyword,
              );
              if (hasPrivateModifier) {
                return false;
              }
            }

            // Filter out JavaScript private identifiers (#field)
            if ('name' in member && member.name) {
              if (ts.isPrivateIdentifier(member.name)) {
                return false;
              }
            }

            return true;
          }),
        );

        rootNode = context.factory.updateClassDeclaration(
          rootNode,
          rootNode.modifiers,
          rootNode.name,
          rootNode.typeParameters,
          rootNode.heritageClauses,
          members,
        );
      }

      if (ts.isImportTypeNode(rootNode)) {
        let importPath: string;
        if (
          ts.isLiteralTypeNode(rootNode.argument) &&
          ts.isStringLiteral(rootNode.argument.literal)
        ) {
          importPath = rootNode.argument.literal.text;
        } else {
          importPath = rootNode.argument.getText().replace(/['"]/g, '');
        }

        const resolvedModule = this.resolveModule(importPath, sourceFile.fileName);

        if (resolvedModule?.isExternalLibraryImport) {
          return rootNode;
        }

        if (resolvedModule?.resolvedFileName) {
          const importedSourceFile = this.#program.getSourceFile(resolvedModule.resolvedFileName);

          if (importedSourceFile) {
            this.emit(importedSourceFile);

            if (rootNode.isTypeOf && !rootNode.qualifier) {
              const moduleSymbol = this.#typeChecker.getSymbolAtLocation(importedSourceFile);

              if (moduleSymbol) {
                const type = this.#typeChecker.getTypeAtLocation(rootNode);
                const properties = type.getProperties();

                return context.factory.createTypeLiteralNode(
                  properties.reduce((acc, exportSymbol) => {
                    if (exportSymbol.declarations) {
                      const [declaration] = exportSymbol.declarations;

                      acc.push(
                        context.factory.createPropertySignature(
                          context.factory.createNodeArray([
                            context.factory.createModifier(ts.SyntaxKind.ReadonlyKeyword),
                          ]),
                          exportSymbol.name,
                          undefined,
                          ts.isExportAssignment(declaration)
                            ? context.factory.createTypeQueryNode(
                                context.factory.createIdentifier('_default'),
                              )
                            : context.factory.createTypeReferenceNode(exportSymbol.name),
                        ),
                      );
                    }

                    return acc;
                  }, [] as ts.TypeElement[]),
                );
              }
            }

            if (rootNode.qualifier) {
              return rootNode.isTypeOf
                ? context.factory.createTypeQueryNode(rootNode.qualifier, rootNode.typeArguments)
                : rootNode.qualifier;
            }
          }
        }
      }

      // Handle name collisions for declarations (type, interface, class, const, etc.)
      if (
        canHaveName(rootNode) &&
        (ts.isTypeAliasDeclaration(rootNode) ||
          ts.isInterfaceDeclaration(rootNode) ||
          ts.isClassDeclaration(rootNode) ||
          ts.isEnumDeclaration(rootNode) ||
          ts.isVariableStatement(rootNode))
      ) {
        const nodeName = ts.isVariableStatement(rootNode)
          ? (rootNode.declarationList.declarations[0] as any).name.text
          : rootNode.name?.text;

        if (nodeName && this.isExportedName(nodeName)) {
          // Check if it's exported from this file — either inline
          // (`export class X`) or via a standalone `export { X }` declaration.
          const isExportedFromThisFile =
            (ts.canHaveModifiers(rootNode) &&
              rootNode.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) ||
            locallyExportedNames.has(nodeName);

          if (!isExportedFromThisFile) {
            // This is an internal declaration that collides with an exported name
            const newName = this.registerCollision(rootNode, nodeName);

            // Rename the node
            if (ts.isTypeAliasDeclaration(rootNode)) {
              rootNode = context.factory.updateTypeAliasDeclaration(
                rootNode,
                rootNode.modifiers,
                context.factory.createIdentifier(newName),
                rootNode.typeParameters,
                rootNode.type,
              );
            } else if (ts.isInterfaceDeclaration(rootNode)) {
              rootNode = context.factory.updateInterfaceDeclaration(
                rootNode,
                rootNode.modifiers,
                context.factory.createIdentifier(newName),
                rootNode.typeParameters,
                rootNode.heritageClauses,
                rootNode.members,
              );
            } else if (ts.isClassDeclaration(rootNode)) {
              rootNode = context.factory.updateClassDeclaration(
                rootNode,
                rootNode.modifiers,
                context.factory.createIdentifier(newName),
                rootNode.typeParameters,
                rootNode.heritageClauses,
                (rootNode as ts.ClassDeclaration).members,
              );
            } else if (ts.isEnumDeclaration(rootNode)) {
              rootNode = context.factory.updateEnumDeclaration(
                rootNode,
                rootNode.modifiers,
                context.factory.createIdentifier(newName),
                rootNode.members,
              );
            } else if (ts.isVariableStatement(rootNode)) {
              const declaration = rootNode.declarationList.declarations[0];
              rootNode = context.factory.updateVariableStatement(
                rootNode,
                rootNode.modifiers,
                context.factory.updateVariableDeclarationList(rootNode.declarationList, [
                  context.factory.updateVariableDeclaration(
                    declaration,
                    context.factory.createIdentifier(newName),
                    declaration.exclamationToken,
                    declaration.type,
                    declaration.initializer,
                  ),
                ]),
              );
            }
          }
        }
      }

      if (ts.canHaveModifiers(rootNode) && rootNode.modifiers) {
        let hasExport = false;
        let hasDefault = false;

        rootNode = context.factory.replaceModifiers(
          rootNode,
          context.factory.createNodeArray(
            rootNode.modifiers.filter((modifier) => {
              const isExport = modifier.kind === ts.SyntaxKind.ExportKeyword;
              const isDefault = modifier.kind === ts.SyntaxKind.DefaultKeyword;

              if (isExport) {
                hasExport = true;
              }

              if (isDefault) {
                hasDefault = true;
              }

              // remove export and default keywords
              return !isExport && !isDefault;
            }) as ts.Modifier[],
          ),
        );

        if (hasExport) {
          const _node = ts.isVariableStatement(rootNode)
            ? rootNode.declarationList.declarations[0]
            : rootNode;

          if (isRootFile && canHaveName(_node)) {
            if (hasDefault) {
              // export default class/function — emit `export default ClassName;`
              addSpecifier(
                context.factory.createExportSpecifier(false, _node.name.text, 'default'),
              );
            } else {
              const symbol = this.#typeChecker.getSymbolAtLocation(_node.name);

              if (symbol) {
                const aliasedSymbol =
                  symbol.flags & ts.SymbolFlags.Alias
                    ? this.#typeChecker.getAliasedSymbol(symbol)
                    : symbol;

                const isDifferentName = symbol.name !== aliasedSymbol?.name;

                addSpecifier(
                  context.factory.createExportSpecifier(
                    false,
                    isDifferentName ? aliasedSymbol?.name : undefined,
                    aliasedSymbol.name,
                  ),
                );
              }
            }
          }
        }
      }

      if (ts.isTypeReferenceNode(rootNode) && ts.isIdentifier(rootNode.typeName)) {
        const alias = rootNode.typeName.text;

        // First check for renamed nodes by symbol
        const symbol = this.#typeChecker.getSymbolAtLocation(rootNode.typeName);
        if (symbol?.declarations?.[0]) {
          const declaration = symbol.declarations[0];
          const renamedName = this.getRenamedNode(declaration);
          if (renamedName) {
            return context.factory.updateTypeReferenceNode(
              rootNode,
              context.factory.createIdentifier(renamedName),
              rootNode.typeArguments,
            );
          }
        }

        // Then check for alias imports
        const originalName = this.#aliasImportMap.get(alias);
        if (originalName) {
          return context.factory.updateTypeReferenceNode(
            rootNode,
            context.factory.createIdentifier(originalName),
            rootNode.typeArguments,
          );
        }
      }

      if (ts.isIdentifier(rootNode)) {
        const alias = rootNode.text;

        // First check for renamed nodes by symbol
        const symbol = this.#typeChecker.getSymbolAtLocation(rootNode);
        if (symbol?.declarations?.[0]) {
          const declaration = symbol.declarations[0];
          const renamedName = this.getRenamedNode(declaration);
          if (renamedName) {
            return context.factory.createIdentifier(renamedName);
          }
        }

        // Then check for alias imports
        const original = this.#aliasImportMap.get(alias);
        if (original) {
          return context.factory.createIdentifier(original);
        }
      }

      // TypeAlias.NamespaceType
      if (ts.isQualifiedName(rootNode) && ts.isIdentifier(rootNode.left)) {
        let currentNode = rootNode;
        let alias = rootNode.left.text;

        // Пытаемся пройтись по всей цепочке qualified names
        while (ts.isQualifiedName(currentNode.right)) {
          currentNode = currentNode.right;
        }

        // Проверка наличия alias в map
        if (this.#aliasImportMap.has(alias)) {
          return context.factory.createIdentifier(currentNode.right.text);
        }
      }

      return ts.visitEachChild(rootNode, visitor, context);
    };

    const visitedFile = ts.visitNode(sourceFile, visitor) as ts.SourceFile;

    if (isRootFile && exportsSpecifiers.length > 0) {
      const exportDeclaration = context.factory.createExportDeclaration(
        context.factory.createNodeArray([]),
        false,
        context.factory.createNamedExports(exportsSpecifiers),
      );

      this.#exports.unshift(
        this.#printer.printNode(ts.EmitHint.Unspecified, exportDeclaration, visitedFile),
      );
    }

    // Process namespace exports (from export { Utils } where Utils is import * as Utils)
    if (isRootFile && namespaceExports.length > 0) {
      for (const { name, sourceFile: nsSourceFile } of namespaceExports) {
        // Emit the namespace source file to ensure all types are processed
        this.emit(nsSourceFile);

        // Create namespace declaration similar to export * as Namespace
        const namespaceDeclaration = context.factory.createModuleDeclaration(
          undefined,
          context.factory.createIdentifier(name),
          context.factory.createModuleBlock(
            this.updateStatements(nsSourceFile.statements, statementVisitor),
          ),
          ts.NodeFlags.Namespace,
        );

        this.#exports.push(
          this.#printer.printNode(ts.EmitHint.Unspecified, namespaceDeclaration, visitedFile),
        );
      }
    }

    return visitedFile;
  }

  private transformer: ts.TransformerFactory<ts.SourceFile | ts.Bundle> = (context) => {
    return (sourceFile) => {
      if (!ts.isSourceFile(sourceFile)) {
        return sourceFile;
      }

      return this.transformFile(sourceFile, context);
    };
  };

  emit(sourceFile: ts.SourceFile) {
    // First pass: collect exported names from root file (do this once per root file)
    // This happens on the first emit call after setRootFile
    if (this.#exportedNames.size === 0) {
      this.collectExportedNames(this.#rootFile);
    }

    if (this.#emittedFiles.has(sourceFile.fileName)) {
      return;
    }

    this.#emittedFiles.add(sourceFile.fileName);

    this.#program.emit(
      sourceFile,
      (_, text) => {
        this.#declarationParts.push(text);
      },
      undefined,
      true,
      { afterDeclarations: [this.transformer] },
    );

    return this.declaration;
  }

  dispose() {
    this.#aliasImportMap.clear();
    this.#emittedFiles.clear();
    this.#visitedCache = new WeakSet<ts.Node>();
    this.resetBuffers();
  }
}
