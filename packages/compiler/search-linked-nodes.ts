import ts from 'typescript';
import { isFromStdLib, isNodeFromPackage } from '../lib';

const getIdentifierFromQualifiedName = (
  node: ts.QualifiedName | ts.Identifier,
): ts.Identifier | null => {
  if (!ts.isQualifiedName(node) && !ts.isIdentifier(node)) return null;

  if (ts.isIdentifier(node)) return node;

  return getIdentifierFromQualifiedName(node.left);
};

const isCanBeAliasSymbol = (symbol: ts.Symbol) => symbol.flags & ts.SymbolFlags.Alias;

const addToCollection = (node: ts.Node, collection: Set<ts.Node>): void => {
  if (!isFromStdLib(node) && !ts.isToken(node)) {
    collection.add(node);
  }
};

export const createSearchLinkedNodes = (typeChecker: ts.TypeChecker) => {
  const cache = new Map<ts.Node, Set<ts.Node>>();

  const searchLinkedNodesFromNode = (node: ts.Node) => {
    const collection = new Set<ts.Node>();

    if (ts.isObjectLiteralExpression(node)) {
      node.properties.forEach((property) => {
        if (ts.isShorthandPropertyAssignment(property)) {
          const type = typeChecker.getTypeAtLocation(property);
          const linkedNode = type.symbol?.declarations?.[0];

          if (linkedNode) {
            addToCollection(linkedNode, collection);
          }
        }

        if (ts.isPropertyAssignment(property)) {
          if (
            ts.isObjectLiteralExpression(property.initializer) ||
            ts.isPropertyAccessExpression(property.initializer)
          ) {
            addToCollection(property.initializer, collection);
          }

          const type = typeChecker.getTypeAtLocation(property.initializer);
          const linkedNode = type.symbol?.declarations?.[0];

          if (linkedNode) {
            addToCollection(linkedNode, collection);
          }
        }
      });
    }

    if (ts.isArrayLiteralExpression(node)) {
      node.elements.forEach((element) => {
        if (ts.isIdentifier(element)) {
          const type = typeChecker.getTypeAtLocation(element);
          const linkedNode = type.symbol?.declarations?.[0];

          if (linkedNode) {
            addToCollection(linkedNode, collection);
          }
        }
      });
    }

    // const foo = FooService.getValue
    if (ts.isPropertyAccessExpression(node)) {
      const type = typeChecker.getTypeAtLocation(node.expression);
      const linkedNode = type.symbol?.declarations?.[0];

      if (linkedNode) {
        addToCollection(linkedNode, collection);
      }
    }

    if (ts.isIdentifier(node)) {
      const symbol = typeChecker.getSymbolAtLocation(node);

      if (symbol) {
        const realSymbol = isCanBeAliasSymbol(symbol)
          ? typeChecker.getAliasedSymbol(symbol)
          : symbol;

        if (realSymbol.declarations?.length) {
          const declaration = realSymbol.declarations[0];

          if (declaration) {
            addToCollection(declaration, collection);
          }
        }
      }
    }

    if (ts.isParenthesizedExpression(node)) {
      addToCollection(node.expression, collection);
    }

    if (ts.isAsExpression(node)) {
      if (node.type) {
        addToCollection(node.type, collection);
      }
    }

    if (ts.isTypeParameterDeclaration(node)) {
      if (node.default) {
        addToCollection(node.default, collection);
      }

      if (node.constraint) {
        addToCollection(node.constraint, collection);
      }
    }

    if (ts.isCallOrNewExpression(node)) {
      if (ts.isPropertyAccessExpression(node.expression)) {
        const symbol = typeChecker.getSymbolAtLocation(node.expression.expression);

        if (symbol) {
          const realSymbol = isCanBeAliasSymbol(symbol)
            ? typeChecker.getAliasedSymbol(symbol)
            : symbol;

          if (realSymbol.declarations?.length) {
            const declaration = realSymbol.declarations[0];

            if (declaration) {
              addToCollection(declaration, collection);
            }
          }
        }
      }

      const signature = typeChecker.getResolvedSignature(node);

      if (signature) {
        const returnType = typeChecker.getReturnTypeOfSignature(signature);

        const symbol = returnType.getSymbol();

        if (symbol) {
          const { declarations } = symbol;

          if (declarations) {
            declarations.forEach((callDeclaration) => {
              if (!isNodeFromPackage(callDeclaration) && !isFromStdLib(callDeclaration)) {
                const typeNode = ts.isTypeLiteralNode(callDeclaration)
                  ? callDeclaration.parent
                  : callDeclaration;

                addToCollection(typeNode, collection);
              }

              if (ts.isFunctionLike(callDeclaration)) {
                const type = callDeclaration.type;

                if (type) {
                  addToCollection(type, collection);
                }
              }
            });
          }
        }
      }
    }

    if (ts.isTypeQueryNode(node)) {
      if (ts.isQualifiedName(node.exprName)) {
        const identifier = getIdentifierFromQualifiedName(node.exprName);

        if (identifier) {
          const symbolAtLocation = typeChecker.getSymbolAtLocation(identifier);

          const declaration = symbolAtLocation?.declarations?.[0];

          if (declaration) {
            addToCollection(declaration, collection);
          }
        }
      } else {
        const symbolAtLocation = typeChecker.getSymbolAtLocation(node.exprName);

        if (symbolAtLocation) {
          const aliasedSymbol = isCanBeAliasSymbol(symbolAtLocation)
            ? typeChecker.getAliasedSymbol(symbolAtLocation)
            : symbolAtLocation;

          const declaration = aliasedSymbol.declarations?.[0];

          if (declaration) {
            addToCollection(declaration, collection);
          }
        }
      }
    }

    if (ts.isTypeOperatorNode(node)) {
      addToCollection(node.type, collection);
    }

    if (ts.isTypeReferenceNode(node)) {
      const symbol = typeChecker.getSymbolAtLocation(node.typeName);
      const declarations = symbol?.declarations;

      node.typeArguments?.forEach((typeNode) => {
        addToCollection(typeNode, collection);
      });

      if (declarations && declarations.length > 0) {
        declarations.forEach((declaration) => {
          addToCollection(declaration, collection);
        });
      }
    }

    if (ts.isTypeLiteralNode(node)) {
      node.members.forEach((member) => {
        if (member.name && ts.isComputedPropertyName(member.name)) {
          const symbol = typeChecker.getSymbolAtLocation(member.name.expression);

          if (symbol) {
            const realSymbol = isCanBeAliasSymbol(symbol)
              ? typeChecker.getAliasedSymbol(symbol)
              : symbol;

            if (realSymbol.declarations?.length) {
              addToCollection(realSymbol.declarations[0], collection);
            }
          }
        }

        if (ts.isIndexSignatureDeclaration(member)) {
          addToCollection(member.type, collection);
        }

        if (ts.isPropertySignature(member)) {
          if (member.type) {
            addToCollection(member.type, collection);
          }
        }
      });
    }

    if (ts.isIntersectionTypeNode(node)) {
      node.types.forEach((typeNode) => {
        addToCollection(typeNode, collection);
      });
    }

    if (ts.isFunctionLike(node)) {
      const type = typeChecker.getTypeAtLocation(node);
      const valueDeclaration = type.getCallSignatures()?.[0]?.getReturnType()
        ?.symbol?.valueDeclaration;

      if (valueDeclaration) {
        addToCollection(valueDeclaration, collection);
      } else {
        if ('body' in node && node.body) {
          if (ts.isExpression(node.body)) {
            addToCollection(node.body, collection);
          }

          if (ts.isBlock(node.body)) {
            node.body.statements.forEach((statement) => {
              if (ts.isReturnStatement(statement)) {
                if (statement.expression) {
                  addToCollection(statement.expression, collection);
                }
              }
            });
          }
        }
      }

      if (node.typeParameters?.length) {
        node.typeParameters.forEach((typeParameter) => {
          addToCollection(typeParameter, collection);
        });
      }

      if (node.parameters.length > 0) {
        node.parameters.forEach((parameter) => {
          if (parameter.type) {
            addToCollection(parameter.type, collection);
          }
        });
      }

      if (node.type) {
        console.log(node.type.getText(), node.type.kind);
        addToCollection(node.type, collection);
      }
    }

    if (ts.isUnionTypeNode(node)) {
      node.types.forEach((typeNode) => {
        addToCollection(typeNode, collection);
      });
    }

    if (ts.isParenthesizedTypeNode(node)) {
      addToCollection(node.type, collection);
    }

    if (ts.isIndexedAccessTypeNode(node)) {
      addToCollection(node.objectType, collection);
    }

    if (ts.isTemplateLiteralTypeNode(node)) {
      node.templateSpans.forEach((node) => {
        addToCollection(node.type, collection);
      });
    }

    if (ts.isArrayTypeNode(node)) {
      addToCollection(node.elementType, collection);
    }

    if (ts.isTupleTypeNode(node)) {
      node.elements.forEach((element) => {
        addToCollection(element, collection);
      });
    }

    if (ts.isMappedTypeNode(node)) {
      [node.type, node.nameType, node.typeParameter.constraint].forEach((type) => {
        if (type) {
          addToCollection(type, collection);
        }
      });
    }

    if (ts.isConditionalTypeNode(node)) {
      [node.checkType, node.falseType, node.extendsType, node.trueType].forEach(
        (conditionalTypePart) => {
          const type = ts.isParenthesizedTypeNode(conditionalTypePart)
            ? conditionalTypePart.type
            : conditionalTypePart;

          addToCollection(type, collection);
        },
      );
    }

    collection.forEach((node) => {
      searchLinkedNodesFromNode(node).forEach((nestedNode) =>
        addToCollection(nestedNode, collection),
      );
    });

    return collection;
  };

  return (node: ts.Node) => {
    if (isFromStdLib(node) || ts.isToken(node)) {
      return [];
    }

    if (cache.has(node)) {
      return [...cache.get(node)!];
    }

    return [...searchLinkedNodesFromNode(node)];
  };
};
