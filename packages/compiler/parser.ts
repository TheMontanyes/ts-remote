import ts from 'typescript';

import {
  ClassDeclarationDefinition,
  FunctionDeclarationDefinition,
  ParsedModule,
  ParsedNode,
  ReExportModule,
  VariableDeclarationDefinition,
} from './types';
import { createSearchLinkedNodes } from './search-linked-nodes';
import { createRegexpIdentifier, getJsDOC, isFromStdLib, isNodeFromPackage } from '../lib';
import {
  printClassDeclarationDefinition,
  printFunctionDeclarationDefinition,
  printModifiers,
  printVariableDeclarationDefinition,
} from './printer';
import path from 'path';

const getPackagePath = (fileName: string) => {
  const [, libPath] = fileName.split('/node_modules/');
  const parsedPath = path.parse(
    libPath
      .replace(/["']/g, '')
      .replace(/\/index$/, '')
      .replace(/^@types\//, ''),
  );

  return path.join(parsedPath.dir, parsedPath.name);
};

const replaceImport = (str: string) => {
  return str.replace(/import\("(.*?)"\)((\.)?)/g, (substring, args) => {
    if (args.includes('/node_modules/')) {
      const packagePath = getPackagePath(args);

      return substring.replace(args, packagePath);
    }

    return '';
  });
};

export const createParser = (program: ts.Program) => {
  const typeChecker = program.getTypeChecker();
  const collectionParsedNodes = new Map<ts.Node, ParsedNode>();
  const searchLinkedNodes = createSearchLinkedNodes(typeChecker);

  const { stdLibIdentifierNames, packages } = program.getSourceFiles().reduce(
    (acc, sourceFile) => {
      if (isNodeFromPackage(sourceFile)) {
        acc.packages.add(sourceFile.fileName);

        if (isFromStdLib(sourceFile)) {
          sourceFile.forEachChild((node) => {
            if (
              ts.isTypeAliasDeclaration(node) ||
              ts.isInterfaceDeclaration(node) ||
              ts.isEnumDeclaration(node)
            ) {
              if (node.name) {
                acc.stdLibIdentifierNames.add(node.name.getText());
              }
            }
          });
        }
      }

      return acc;
    },
    { stdLibIdentifierNames: new Set<string>(), packages: new Set<string>() },
  );

  const parseVariableDeclaration = (declaration: ts.VariableDeclaration): ParsedNode => {
    const statement = declaration.parent.parent as ts.VariableStatement;

    const type = typeChecker.getTypeAtLocation(declaration);
    const typeString = typeChecker.typeToString(type, declaration, ts.TypeFormatFlags.NoTruncation);

    const definition: VariableDeclarationDefinition = {
      identifierName: declaration.name.getText(),
      typeAnnotation: typeString,
      keyword: ts.ScriptElementKind.constElement,
      modifiers: printModifiers(statement.modifiers),
    };

    const parsed: ParsedNode = {
      jsDoc: getJsDOC(declaration),
      name: definition.identifierName,
      code: printVariableDeclarationDefinition(definition),
      linkedNodes: [],
      astNode: declaration,
    };

    if (declaration.type) {
      const nodes = searchLinkedNodes(declaration.type);

      if (nodes.length > 0) {
        parsed.linkedNodes.push(...nodes);
      }
    } else {
      const expression = declaration.initializer;

      definition.typeAnnotation = replaceImport(definition.typeAnnotation);
      parsed.code = printVariableDeclarationDefinition(definition);

      if (expression) {
        const nodes = searchLinkedNodes(
          ts.isAsExpression(expression) ? expression.type : expression,
        );

        if (nodes.length > 0) {
          parsed.linkedNodes.push(...nodes);
        }
      }
    }

    return parsed;
  };

  const parseFunctionDeclaration = (declaration: ts.FunctionDeclaration): ParsedNode => {
    const signature = typeChecker.getSignatureFromDeclaration(declaration);

    const returnType =
      declaration.type?.getText() ||
      (signature &&
        typeChecker.typeToString(
          signature.getReturnType(),
          signature.declaration,
          ts.TypeFormatFlags.NoTruncation,
        )) ||
      'any';

    const definition: FunctionDeclarationDefinition = {
      identifierName: declaration.name ? declaration.name.getText() : '__anonymous',
      parameters: [],
      returnType: replaceImport(returnType),
      keyword: ts.ScriptElementKind.functionElement,
      modifiers: printModifiers(declaration.modifiers),
      typeParameters: declaration.typeParameters
        ? parseTypeParameters(declaration.typeParameters)
        : '',
    };

    if (declaration.parameters.length > 0) {
      declaration.parameters.forEach((parameter) => {
        definition.parameters.push(
          `${parameter.name.getText()}${typeChecker.isOptionalParameter(parameter) ? '?:' : ':'} ${
            parameter.type?.getText() ?? 'any'
          }`,
        );
      });
    }

    return {
      jsDoc: getJsDOC(declaration),
      name: definition.identifierName,
      code: printFunctionDeclarationDefinition(definition),
      linkedNodes: [...searchLinkedNodes(declaration)],
    } as ParsedNode;
  };

  const parseVariableStatement = (statement: ts.VariableStatement) => {
    const [declaration] = statement.declarationList.declarations;
    return parseVariableDeclaration(declaration);
  };

  const parseTypeAliasDeclaration = (declaration: ts.TypeAliasDeclaration): ParsedNode => {
    const parsed: ParsedNode = {
      jsDoc: getJsDOC(declaration),
      astNode: declaration,
      name: declaration.name.getText(),
      code: declaration.getText().trim(),
      linkedNodes: [],
    };

    if (declaration.typeParameters?.length) {
      declaration.typeParameters.forEach((typeParameter) => {
        const nodes = searchLinkedNodes(typeParameter);

        if (nodes.length > 0) {
          parsed.linkedNodes.push(...nodes);
        }
      });
    }

    if (declaration.type) {
      const nodes = searchLinkedNodes(declaration.type);

      if (nodes.length > 0) {
        parsed.linkedNodes.push(...nodes);
      }
    }

    return parsed;
  };

  const parseEnumDeclaration = (declaration: ts.EnumDeclaration): ParsedNode => {
    return {
      jsDoc: getJsDOC(declaration),
      astNode: declaration,
      name: declaration.name.getText(),
      code: declaration.getText().trim(),
      linkedNodes: [],
    };
  };

  const parseInterfaceDeclaration = (declaration: ts.InterfaceDeclaration): ParsedNode => {
    const parsed: ParsedNode = {
      jsDoc: getJsDOC(declaration),
      astNode: declaration,
      name: declaration.name.getText(),
      code: declaration.getText().trim(),
      linkedNodes: [],
    };

    if (declaration.typeParameters?.length) {
      declaration.typeParameters.forEach((typeParameter) => {
        const nodes = searchLinkedNodes(typeParameter);

        if (nodes.length > 0) {
          parsed.linkedNodes.push(...nodes);
        }
      });
    }

    declaration.heritageClauses?.forEach((clause) => {
      clause.types.forEach((expression) => {
        const symbol = typeChecker.getSymbolAtLocation(expression.expression);

        if (symbol?.declarations) {
          symbol?.declarations.forEach((clauseDeclaration) => {
            if (clauseDeclaration) {
              parsed.linkedNodes.push(clauseDeclaration);
            }

            expression.typeArguments?.forEach((typeNode) => {
              const nodes = searchLinkedNodes(typeNode);

              if (nodes.length > 0) {
                parsed.linkedNodes.push(...nodes);
              }
            });
          });
        }
      });
    });

    declaration.members.forEach((member) => {
      if (ts.isFunctionLike(member)) {
        const nodes = searchLinkedNodes(member);

        if (nodes.length > 0) {
          parsed.linkedNodes.push(...nodes);
        }
      }

      if (ts.isPropertySignature(member) && member.type) {
        const nodes = searchLinkedNodes(member.type);

        if (nodes.length > 0) {
          parsed.linkedNodes.push(...nodes);
        }
      }
    });

    return parsed;
  };

  const parseTypeParameters = (
    typeParameters: ts.TypeParameterDeclaration[] | ts.NodeArray<ts.TypeParameterDeclaration>,
  ) => {
    return `<${typeParameters.map((typeParameter) => typeParameter.getText()).join(', ')}>`;
  };

  const parseClassDeclaration = (declaration: ts.ClassDeclaration): ParsedNode => {
    const definition: ClassDeclarationDefinition = {
      keyword: ts.ScriptElementKind.classElement,
      heritageClauses: [],
      constructorParameters: [],
      modifiers: printModifiers(declaration.modifiers),
      members: [],
      identifierName: declaration.name?.getText() || '__anonymous',
      typeParameters: declaration.typeParameters
        ? parseTypeParameters(declaration.typeParameters)
        : '',
    };

    const parsed: ParsedNode = {
      jsDoc: getJsDOC(declaration),
      astNode: declaration,
      linkedNodes: [],
      code: '',
      name: definition.identifierName,
    };

    if (declaration.typeParameters?.length) {
      declaration.typeParameters.forEach((typeParameter) => {
        const nodes = searchLinkedNodes(typeParameter);

        if (nodes.length > 0) {
          parsed.linkedNodes.push(...nodes);
        }
      });
    }

    declaration.heritageClauses?.forEach((clause) => {
      definition.heritageClauses.push(clause.getText());

      clause.types.forEach((expression) => {
        const symbol = typeChecker.getSymbolAtLocation(expression.expression);

        if (symbol?.declarations?.length) {
          symbol.declarations.forEach((clauseDeclaration) => {
            if (clauseDeclaration) {
              parsed.linkedNodes.push(clauseDeclaration);
            }

            expression.typeArguments?.forEach((typeNode) => {
              const nodes = searchLinkedNodes(typeNode);

              if (nodes.length > 0) {
                parsed.linkedNodes.push(...nodes);
              }
            });
          });
        }
      });
    });

    definition.members = declaration.members.reduce((acc, member) => {
      if (ts.isFunctionLike(member)) {
        const nodes = searchLinkedNodes(member);

        if (nodes.length > 0) {
          parsed.linkedNodes.push(...nodes);
        }
      }

      if (ts.isConstructorDeclaration(member)) {
        definition.constructorParameters = member.parameters.map((parameter) => {
          let text = '';

          if (parameter.modifiers?.length) {
            text += printModifiers(parameter.modifiers).join(' ');
            text += ' ';
          }

          text += parameter.name.getText();

          if (typeChecker.isOptionalParameter(parameter)) {
            text += '?';
          }

          text += ':';
          text += ' ';

          text += parameter.type?.getText() || 'any';

          return text;
        });

        return acc;
      }

      if (ts.isMethodDeclaration(member) || ts.isAccessor(member)) {
        const signature = typeChecker.getSignatureFromDeclaration(member);
        const signatureReturnType = signature?.getReturnType();
        const signatureReturnTypeString =
          signature &&
          signatureReturnType &&
          typeChecker.typeToString(
            signatureReturnType,
            signature.declaration,
            ts.TypeFormatFlags.NoTruncation,
          );

        const returnStatements = new Set<ts.ReturnStatement>();

        const getReturnStatementFromBody = (node: ts.Node) => {
          if (ts.isIfStatement(node)) {
            node.thenStatement.forEachChild(getReturnStatementFromBody);

            node.elseStatement?.forEachChild(getReturnStatementFromBody);
          }

          if (ts.isBlock(node)) {
            node.statements.forEach(getReturnStatementFromBody);
          }

          if (ts.isReturnStatement(node)) {
            returnStatements.add(node);
          }
        };

        member.body?.forEachChild(getReturnStatementFromBody);

        const returnTypes = [...returnStatements].reduce((type, returnStatement) => {
          if (!returnStatement.expression) {
            type.add('undefined');

            return type;
          }

          const typeNode = typeChecker.getTypeAtLocation(returnStatement.expression);
          const typeString = typeChecker.typeToString(
            typeNode,
            returnStatement.expression,
            ts.TypeFormatFlags.NoTruncation,
          );

          if (typeNode.symbol?.declarations) {
            const node = typeNode.symbol.declarations[0];

            const nodes = searchLinkedNodes(node);

            if (nodes.length > 0) {
              parsed.linkedNodes.push(...nodes);
            }
          }

          if (ts.isPropertyAccessExpression(returnStatement.expression)) {
            if (ts.isIdentifier(returnStatement.expression.expression)) {
              const symbol = typeChecker.getSymbolAtLocation(returnStatement.expression.expression);

              if (symbol) {
                const realSymbol =
                  symbol.flags & ts.SymbolFlags.Alias
                    ? typeChecker.getAliasedSymbol(symbol)
                    : symbol;

                const declaration = realSymbol.declarations?.[0];

                if (declaration && ts.isEnumDeclaration(declaration)) {
                  type.add(declaration.name.getText());

                  return type;
                }
              }
            }
          }

          type.add(typeString);

          return type;
        }, new Set<string>());

        const returnType =
          member.type?.getText() ||
          (returnTypes.size > 0 && [...returnTypes].join(' | ')) ||
          signatureReturnTypeString ||
          'any';

        if (signatureReturnType?.symbol) {
          const declarations = signatureReturnType.symbol.getDeclarations();

          if (declarations?.length) {
            declarations.forEach((declaration) => {
              const nodes = searchLinkedNodes(declaration);

              if (nodes.length > 0) {
                parsed.linkedNodes.push(...nodes);
              }
            });
          }
        }

        let resultMember = `${member.name.getText()}`;

        if (member.typeParameters?.length) {
          resultMember += `<${member.typeParameters
            .map((parameter) => parameter.getText())
            .join(', ')}>`;
        }

        const parameters: string[] = [];

        if (member.parameters.length) {
          member.parameters.forEach((parameter) => {
            parameters.push(
              `${parameter.name.getText()}${
                typeChecker.isOptionalParameter(parameter) ? '?:' : ':'
              } ${parameter.type?.getText() ?? 'any'}`,
            );

            if (parameter.type) {
              const nodes = searchLinkedNodes(parameter.type);

              if (nodes.length > 0) {
                parsed.linkedNodes.push(...nodes);
              }
            }
          });
        }

        resultMember += `(${parameters.join(', ')}): ${replaceImport(returnType)}`;

        if (ts.isGetAccessor(member)) {
          resultMember = `get ${resultMember}`;
        }

        if (ts.isSetAccessor(member)) {
          resultMember = `set ${resultMember}`;
        }

        if (member.modifiers?.length) {
          resultMember = `${printModifiers(member.modifiers).join(' ')} ${resultMember}`;
        }

        const jsDOC = getJsDOC(member);

        if (jsDOC) {
          resultMember = `${jsDOC}${ts.sys.newLine}${resultMember}`;
        }

        acc.push(resultMember);

        return acc;
      }

      if (ts.isPropertyDeclaration(member)) {
        let resultMember = ``;
        const type = typeChecker.getTypeAtLocation(member.name);
        const typeStringMember = typeChecker.typeToString(
          type,
          member.name,
          ts.TypeFormatFlags.NoTruncation,
        );

        if (member.initializer) {
          const nodes = searchLinkedNodes(member.initializer);

          if (nodes.length > 0) {
            parsed.linkedNodes.push(...nodes);
          }
        }

        if (member.type) {
          const nodes = searchLinkedNodes(member.type);

          if (nodes.length > 0) {
            parsed.linkedNodes.push(...nodes);
          }
        }

        if (ts.canHaveModifiers(member) && member.modifiers?.length) {
          resultMember += printModifiers(member.modifiers).join(' ');
          resultMember += ' ';
        }

        resultMember += `${member.name?.getText()}: ${replaceImport(typeStringMember)}`;

        if (member.initializer && ts.isCallOrNewExpression(member.initializer)) {
          const type = typeChecker.getTypeAtLocation(member.initializer.expression);
          const sourceFile = type.symbol.valueDeclaration?.getSourceFile();

          if (
            sourceFile &&
            ts.isIdentifier(member.initializer.expression) &&
            isNodeFromPackage(sourceFile)
          ) {
            const name = member.initializer.expression.getText();
            const packagePath = getPackagePath(sourceFile.fileName);

            resultMember = resultMember.replace(
              createRegexpIdentifier(name),
              `import("${packagePath}").${name}`,
            );
          }
        }

        const jsDOC = getJsDOC(member);

        if (jsDOC) {
          resultMember = `${jsDOC}${ts.sys.newLine}${resultMember}`;
        }

        acc.push(resultMember);

        return acc;
      }

      return acc;
    }, definition.members);

    parsed.code = printClassDeclarationDefinition(definition);

    return parsed;
  };

  const parseNode = (node: ts.Node): ParsedNode | undefined => {
    if (isFromStdLib(node) || isNodeFromPackage(node)) {
      return;
    }

    const parsed = (() => {
      if (collectionParsedNodes.has(node)) {
        return collectionParsedNodes.get(node);
      }

      if (ts.isVariableStatement(node)) {
        return parseVariableStatement(node);
      }

      if (ts.isVariableDeclaration(node)) {
        return parseVariableDeclaration(node);
      }

      if (ts.isFunctionDeclaration(node)) {
        return parseFunctionDeclaration(node);
      }

      if (ts.isTypeAliasDeclaration(node)) {
        return parseTypeAliasDeclaration(node);
      }

      if (ts.isInterfaceDeclaration(node)) {
        return parseInterfaceDeclaration(node);
      }

      if (ts.isEnumDeclaration(node)) {
        return parseEnumDeclaration(node);
      }

      if (ts.isClassDeclaration(node)) {
        return parseClassDeclaration(node);
      }

      if (ts.isImportSpecifier(node)) {
        const importSymbol = typeChecker.getSymbolAtLocation(node.name);

        if (importSymbol) {
          const aliasedSymbol = typeChecker.getAliasedSymbol(importSymbol);

          if (aliasedSymbol.declarations) {
            return parseNode(aliasedSymbol.valueDeclaration || aliasedSymbol.declarations[0]);
          }
        }
      }

      return;
    })();

    if (parsed) {
      collectionParsedNodes.set(node, parsed);
    }

    return parsed;
  };

  const visitedLinkedNodes = new Set<string>();
  const collisionsMap = new Map<string, Set<string>>();

  const parseLinkedNodes = (parsedNode: ParsedNode): Set<ParsedNode> | undefined => {
    const keyVisited = `${parsedNode.name}_${parsedNode.linkedNodes.length}`;

    if (parsedNode.linkedNodes.length === 0 || visitedLinkedNodes.has(keyVisited)) return;

    visitedLinkedNodes.add(keyVisited);

    return parsedNode.linkedNodes.reduce((acc, node) => {
      const parsed = parseNode(node);

      if (parsed) {
        if (!collisionsMap.has(parsed.name)) {
          collisionsMap.set(parsed.name, new Set());
        }

        const list = collisionsMap.get(parsed.name)!;
        const fileName = parsed.astNode.getSourceFile().fileName;

        if (stdLibIdentifierNames.has(parsed.name)) {
          list.add(parsed.name + parsedNode.name);
        }

        list.add(fileName);

        if (list.size > 1) {
          const idx = [...list].findIndex(
            (f) => f === fileName && f !== parsed.name + parsedNode.name,
          );

          if (idx > 0) {
            const newName = `${parsed.name}_${idx}`;

            parsed.code = parsed.code.replace(new RegExp(`\\b${parsed.name}\\b`), newName);

            parsedNode.code = parsedNode.code.replace(new RegExp(`\\b${parsed.name}\\b`), newName);

            collectionParsedNodes.set(parsed.astNode, parsed);
          }
        }
      }

      if (ts.isImportSpecifier(node)) {
        const importSymbol = typeChecker.getSymbolAtLocation(node.name);

        if (importSymbol) {
          const aliasedSymbol = typeChecker.getAliasedSymbol(importSymbol);

          if (aliasedSymbol.declarations) {
            aliasedSymbol.declarations.forEach((importedNode) => {
              if (isNodeFromPackage(importedNode)) {
                const regexpIdentifier = createRegexpIdentifier(importSymbol.name);
                const packageName = node.parent.parent.parent.moduleSpecifier.getText();
                const property = node.propertyName ? node.propertyName.getText() : node.name.text;

                parsedNode.code = parsedNode.code.replace(
                  regexpIdentifier,
                  `import(${packageName}).${property}`,
                );
              }
            });
          }
        }
      } else if (isNodeFromPackage(node)) {
        if (ts.isModuleBlock(node.parent)) {
          const moduleSymbol = typeChecker.getSymbolAtLocation(node.parent.getSourceFile());
          const modulePath = moduleSymbol?.name;

          if (modulePath) {
            const packagePath = getPackagePath(modulePath);

            parsedNode.code = parsedNode.code.replace(
              createRegexpIdentifier(node.parent.parent.name.getText()),
              `import("${packagePath}")`,
            );
          }
        }
      }

      if (ts.isModuleDeclaration(node)) {
        if (ts.isSourceFile(node.parent)) {
          const sourceFile = node.parent.getSourceFile();
          const moduleSymbol = typeChecker.getSymbolAtLocation(sourceFile);
          const modulePath = moduleSymbol?.name;

          if (modulePath && isNodeFromPackage(sourceFile)) {
            const name = node.name.getText();

            parsedNode.code = parsedNode.code.replace(
              createRegexpIdentifier(name),
              replaceImport(`import(${modulePath}).${name}`),
            );
          }
        }
      }

      if (parsed) {
        acc.add(parsed);

        if (parsed.linkedNodes.length > 0) {
          parseLinkedNodes(parsed)?.forEach((node) => {
            acc.add(node);
          });
        }
      }

      return acc;
    }, new Set<ParsedNode>());
  };

  return (sourceFile: ts.SourceFile): ParsedModule => {
    const moduleSymbol = typeChecker.getSymbolAtLocation(sourceFile);

    const defaultParsedModule = {
      linkedParsedNodes: new Set(),
      exportedParsedNodes: new Set(),
      reExportsFromExternalModules: new Map(),
      exportDefaultParsedNode: undefined,
      exportIdentifiers: new Map(),
    } as ParsedModule;

    if (!moduleSymbol) {
      return defaultParsedModule;
    }

    const exportSymbolsFromModule = typeChecker.getExportsOfModule(moduleSymbol);
    const list = new Set([...exportSymbolsFromModule, ...(moduleSymbol.exports?.values() ?? [])]);

    const module = [...list].reduce((acc, exportSymbol) => {
      const declarations = exportSymbol.declarations;

      if (declarations?.length) {
        const [node] = declarations;

        // export * from ...
        if (ts.isExportDeclaration(node)) {
          if (!node.exportClause) {
            if (node.moduleSpecifier) {
              const existPath = ['/index.ts', '/index.js', '.ts', '.js'].some((restPath) => {
                const pathName = path.resolve(
                  path.dirname(node.getSourceFile().fileName),
                  node.moduleSpecifier!.getText().replace(/'/g, '') + restPath,
                );

                return program.getSourceFile(pathName);
              });

              if (existPath) return acc;

              acc.exportedParsedNodes.add({
                name: '',
                code: `export * from ${node.moduleSpecifier.getText()};`,
                linkedNodes: [],
                astNode: node,
                jsDoc: '',
              });
            }
          }

          return acc;
        }

        // export {} || export {} from ...
        if (ts.isExportSpecifier(node)) {
          const aliasedSymbol = typeChecker.getAliasedSymbol(exportSymbol);
          const declarations = aliasedSymbol?.declarations;
          const isTypeOnly = node.isTypeOnly || node.parent.parent.isTypeOnly;

          if (declarations?.length) {
            const [exportNode] = declarations;

            if (isNodeFromPackage(exportNode)) {
              let packageName = '';

              if (ts.isModuleBlock(exportNode.parent)) {
                packageName = exportNode.parent.parent.name.getText();

                if (packageName) {
                  const reExportModule: ReExportModule = {
                    identifierNameExport: exportSymbol.name,
                    identifierNameImport: exportSymbol.name,
                    isNameSpaceImport: false,
                    isDefaultImport: false,
                    asNameExport: '',
                    asNameImport: '',
                  };

                  if (!acc.reExportsFromExternalModules.has(packageName)) {
                    acc.reExportsFromExternalModules.set(packageName, [reExportModule]);
                  } else {
                    acc.reExportsFromExternalModules.get(packageName)!.push(reExportModule);
                  }
                }
              }

              return acc;
            }

            const parsedNode = parseNode(exportNode);

            if (parsedNode) {
              const parsedLinkedNodes = parseLinkedNodes(parsedNode);

              parsedLinkedNodes?.forEach((linkedNode) => {
                acc.linkedParsedNodes.add(linkedNode);
              });

              acc.exportedParsedNodes.add(parsedNode);

              acc.exportIdentifiers.set(parsedNode.name, { name: parsedNode.name, isTypeOnly });
            }
          } else {
            const hasAsName = Boolean(node.propertyName);
            const nodeName = hasAsName ? node.propertyName!.getText() : exportSymbol.name;
            const sourceFile = node.getSourceFile();

            if (node.parent.parent.moduleSpecifier) {
              let importPath = node.parent.parent.moduleSpecifier.getText();

              if (importPath) {
                const reExportModule: ReExportModule = {
                  identifierNameExport: hasAsName ? node.propertyName!.getText() : nodeName,
                  identifierNameImport: hasAsName ? node.propertyName!.getText() : nodeName,
                  asNameExport: hasAsName ? node.name.getText() : '',
                };

                if (!acc.reExportsFromExternalModules.has(importPath)) {
                  acc.reExportsFromExternalModules.set(importPath, [reExportModule]);
                } else {
                  acc.reExportsFromExternalModules.get(importPath)!.push(reExportModule);
                }
              }
            } else {
              let importPath = '';
              let isDefaultImport = false;
              let isNameSpaceImport = false;

              let importDeclaration: ts.ImportDeclaration | undefined;
              let importSpecifier: ts.ImportSpecifier | undefined;

              sourceFile.statements.some((statement) => {
                if (ts.isImportDeclaration(statement)) {
                  if (statement.importClause) {
                    isDefaultImport = statement.importClause.getText() === nodeName;

                    if (isDefaultImport) {
                      importDeclaration = statement;
                      return true;
                    }

                    if (statement.importClause.namedBindings) {
                      if (ts.isNamespaceImport(statement.importClause.namedBindings)) {
                        isNameSpaceImport =
                          statement.importClause.namedBindings.name.getText() === nodeName;

                        if (isNameSpaceImport) {
                          importDeclaration = statement;
                          return true;
                        }
                      }

                      if (ts.isNamedImports(statement.importClause.namedBindings)) {
                        const findedImportSpecifier =
                          statement.importClause.namedBindings.elements.find((element) => {
                            return element.name.getText() === nodeName;
                          });

                        if (findedImportSpecifier) {
                          importDeclaration = statement;
                          importSpecifier = findedImportSpecifier;
                          return true;
                        }
                      }
                    }
                  }
                }

                return false;
              });

              if (importDeclaration) {
                importPath = importDeclaration.moduleSpecifier.getText();
              }

              if (importPath) {
                const reExportModule: ReExportModule = {
                  identifierNameExport: hasAsName ? node.propertyName!.getText() : nodeName,
                  identifierNameImport: importSpecifier?.propertyName
                    ? importSpecifier.propertyName.getText()
                    : nodeName,
                  isNameSpaceImport,
                  isDefaultImport,
                  asNameExport: hasAsName ? node.name.getText() : '',
                  asNameImport: importSpecifier?.propertyName ? importSpecifier.name.getText() : '',
                };

                if (!acc.reExportsFromExternalModules.has(importPath)) {
                  acc.reExportsFromExternalModules.set(importPath, [reExportModule]);
                } else {
                  acc.reExportsFromExternalModules.get(importPath)!.push(reExportModule);
                }
              }
            }
          }

          return acc;
        }

        // export default
        if (ts.isExportAssignment(node)) {
          // TODO refactor
          const typeString = typeChecker.typeToString(
            typeChecker.getTypeAtLocation(node.expression),
            node.expression,
            ts.TypeFormatFlags.NoTruncation,
          );

          acc.exportDefaultParsedNode = {
            astNode: node.expression,
            jsDoc: '',
            code: `const _default: ${typeString};${ts.sys.newLine}export default _default;`,
            name: '',
            linkedNodes: [],
          };
        }

        if (isNodeFromPackage(node)) {
          let packageName = '';

          if (ts.isModuleBlock(node.parent)) {
            packageName = node.parent.parent.name.getText();

            if (packageName) {
              const reExportModule: ReExportModule = {
                identifierNameExport: exportSymbol.name,
                identifierNameImport: exportSymbol.name,
                isNameSpaceImport: false,
                isDefaultImport: false,
                asNameExport: '',
                asNameImport: '',
              };

              if (!acc.reExportsFromExternalModules.has(packageName)) {
                acc.reExportsFromExternalModules.set(packageName, [reExportModule]);
              } else {
                acc.reExportsFromExternalModules.get(packageName)!.push(reExportModule);
              }
            }
          }

          return acc;
        }

        const parsedNode = parseNode(node);

        if (parsedNode) {
          const parsedLinkedNodes = parseLinkedNodes(parsedNode);

          parsedLinkedNodes?.forEach((linkedNode) => {
            acc.linkedParsedNodes.add(linkedNode);
          });

          acc.exportedParsedNodes.add(parsedNode);

          acc.exportIdentifiers.set(parsedNode.name, { name: parsedNode.name, isTypeOnly: false });
        }
      }

      return acc;
    }, defaultParsedModule);

    // Clearing caches after parsing every module
    visitedLinkedNodes.clear();
    collisionsMap.clear();
    collectionParsedNodes.clear();

    return module;
  };
};
