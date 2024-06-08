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
import {
  createRegexpIdentifier,
  getJsDOC,
  isFromStdLib,
  isNodeFromPackage,
  replaceImport,
} from './lib';
import {
  printClassDeclarationDefinition,
  printFunctionDeclarationDefinition,
  printModifiers,
  printVariableDeclarationDefinition,
} from './printer';

export const createParser = (typeChecker: ts.TypeChecker, stdLibTypes: Set<string>) => {
  const collectionParsedNodes = new Map<ts.Node, ParsedNode>();
  const searchLinkedNodes = createSearchLinkedNodes(typeChecker);

  const parseVariableDeclaration = (declaration: ts.VariableDeclaration): ParsedNode => {
    const statement = declaration.parent.parent as ts.VariableStatement;

    const typeExpressionNode = typeChecker.getTypeAtLocation(declaration);
    const typeString = typeChecker.typeToString(
      typeExpressionNode,
      declaration,
      ts.TypeFormatFlags.NoTruncation,
    );

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
        if (ts.isAsExpression(expression)) {
          if (expression.type) {
            const nodes = searchLinkedNodes(expression.type);

            if (nodes.length > 0) {
              parsed.linkedNodes.push(...nodes);
            }
          }
        } else {
          const nodes = searchLinkedNodes(expression);

          if (nodes.length > 0) {
            parsed.linkedNodes.push(...nodes);
          }
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
      returnType,
      keyword: ts.ScriptElementKind.functionElement,
      modifiers: printModifiers(declaration.modifiers),
      typeParameters: declaration.typeParameters
        ? parseTypeParameters(declaration.typeParameters)
        : '',
    };

    const parsed = {
      jsDoc: getJsDOC(declaration),
      name: definition.identifierName,
      code: printFunctionDeclarationDefinition(definition),
      linkedNodes: [...searchLinkedNodes(declaration)],
    } as ParsedNode;

    if (declaration.parameters.length) {
      declaration.parameters.forEach((parameter) => {
        definition.parameters.push(
          `${parameter.name.getText()}${typeChecker.isOptionalParameter(parameter) ? '?:' : ':'} ${
            parameter.type?.getText() ?? 'any'
          }`,
        );
      });
    }

    return parsed;
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

        const returnType = member.type?.getText() || signatureReturnTypeString || 'any';

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

        resultMember += `(${parameters.join(', ')}): ${returnType}`;

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

        if (stdLibTypes.has(parsed.name)) {
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
            parsedNode.code = parsedNode.code.replace(
              createRegexpIdentifier(node.parent.parent.name.getText()),
              replaceImport(`import(${modulePath})`),
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
    } as ParsedModule;

    if (!moduleSymbol) {
      return defaultParsedModule;
    }

    const exportSymbolsFromModule = typeChecker.getExportsOfModule(moduleSymbol);
    const module = exportSymbolsFromModule.reduce((acc, exportSymbol) => {
      const declarations = exportSymbol.declarations;

      if (declarations) {
        declarations.forEach((node) => {
          if (ts.isExportSpecifier(node)) {
            const hasAsName = Boolean(node.propertyName);

            const nodeName = node.name.getText();

            const symbol = typeChecker.getSymbolAtLocation(node.name);

            if (symbol) {
              const aliasedSymbol = typeChecker.getAliasedSymbol(symbol);
              const declaration = aliasedSymbol.declarations?.[0];

              if (!declaration || isNodeFromPackage(declaration)) {
                const unknownSymbol = (sourceFile as any).locals.get(
                  hasAsName ? node.propertyName!.getText() : nodeName,
                );

                if (unknownSymbol?.declarations?.[0]) {
                  const externalImportModule = unknownSymbol.declarations[0];

                  if (
                    ts.isNamespaceImport(externalImportModule) ||
                    ts.isImportClause(externalImportModule)
                  ) {
                    const packageName = ts.isNamespaceImport(externalImportModule)
                      ? externalImportModule.parent.parent.moduleSpecifier.getText()
                      : externalImportModule.parent.moduleSpecifier.getText();

                    if (externalImportModule.name) {
                      const identifierName = externalImportModule.name.getText();

                      const reExportItem: ReExportModule = {
                        identifierNameImport: identifierName,
                        identifierNameExport: identifierName,
                        isNameSpaceImport: true,
                        asNameExport: hasAsName ? nodeName : undefined,
                      };

                      if (!acc.reExportsFromExternalModules.has(packageName)) {
                        acc.reExportsFromExternalModules.set(packageName, [reExportItem]);
                      } else {
                        acc.reExportsFromExternalModules.get(packageName)!.push(reExportItem);
                      }
                    }

                    return;
                  }

                  if (ts.isImportSpecifier(externalImportModule)) {
                    const packageName =
                      externalImportModule.parent.parent.parent.moduleSpecifier.getText();

                    const reExportItem: ReExportModule = {
                      identifierNameExport: externalImportModule.name.getText(),
                      identifierNameImport: externalImportModule.propertyName
                        ? externalImportModule.propertyName.getText()
                        : externalImportModule.name.getText(),
                      asNameImport: externalImportModule.propertyName
                        ? externalImportModule.name.getText()
                        : undefined,
                      asNameExport: hasAsName ? nodeName : undefined,
                    };

                    if (!acc.reExportsFromExternalModules.has(packageName)) {
                      acc.reExportsFromExternalModules.set(packageName, [reExportItem]);
                    } else {
                      acc.reExportsFromExternalModules.get(packageName)!.push(reExportItem);
                    }

                    return;
                  }
                }
              }

              if (declaration) {
                const parsedNode = parseNode(declaration);

                if (parsedNode) {
                  const parsedLinkedNodes = parseLinkedNodes(parsedNode);

                  parsedLinkedNodes?.forEach((linkedNode) => {
                    acc.linkedParsedNodes.add(linkedNode);
                  });

                  if (hasAsName) {
                    parsedNode.code = parsedNode.code.replace(
                      new RegExp(`\\b${parsedNode.name}\\b`),
                      nodeName,
                    );
                  }

                  acc.exportedParsedNodes.add(parsedNode);
                }
              }
            }
          }

          // export default
          if (ts.isExportAssignment(node)) {
            const typeString = typeChecker.typeToString(
              typeChecker.getTypeAtLocation(node.expression),
              node.expression,
              ts.TypeFormatFlags.NoTruncation,
            );

            acc.exportDefaultParsedNode = {
              astNode: node.expression,
              jsDoc: '',
              code: `const _default: ${replaceImport(typeString)};${
                ts.sys.newLine
              }export default _default;`,
              name: '',
              linkedNodes: [],
            };
          }

          const parsedNode = parseNode(node);

          if (parsedNode) {
            const parsedLinkedNodes = parseLinkedNodes(parsedNode);

            parsedLinkedNodes?.forEach((linkedNode) => {
              acc.linkedParsedNodes.add(linkedNode);
            });

            acc.exportedParsedNodes.add(parsedNode);
          }
        });
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
