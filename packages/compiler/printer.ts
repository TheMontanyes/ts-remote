import {
  ClassDeclarationDefinition,
  CompilerOptions,
  FunctionDeclarationDefinition,
  ParsedModule,
  ParsedNode,
  VariableDeclarationDefinition,
} from './types';
import ts from 'typescript';
import { createRegexpIdentifier } from '../lib';

const printParsedNode = ({ code, jsDoc }: ParsedNode) => {
  let result = '';

  if (jsDoc) {
    result += jsDoc;
    result += ts.sys.newLine;
  }

  result += code;

  return result;
};

function getKeywordFromNode(node: ts.Node) {
  if (!node) return '';

  switch (node.kind) {
    case ts.SyntaxKind.VariableDeclaration:
      return 'const';
    case ts.SyntaxKind.FunctionDeclaration:
      return 'function';
    case ts.SyntaxKind.TypeAliasDeclaration:
      return 'type';
    case ts.SyntaxKind.InterfaceDeclaration:
      return 'interface';
    case ts.SyntaxKind.ClassDeclaration:
      return 'class';
    case ts.SyntaxKind.EnumDeclaration:
      return 'enum';
    default:
      return '';
  }
}

export const printModifiers = (modifiers?: ts.NodeArray<ts.ModifierLike>): string[] => {
  if (!modifiers) return [];

  return modifiers.reduce((acc: string[], modifier) => {
    if (
      ![
        ts.SyntaxKind.AsyncKeyword,
        ts.SyntaxKind.ExportKeyword,
        ts.SyntaxKind.DeclareKeyword,
        ts.SyntaxKind.Decorator,
      ].includes(modifier.kind)
    ) {
      acc.push(modifier.getText());
    }

    return acc;
  }, []);
};

type PrintModuleOptions = {
  moduleName: string;
  parsedModule: ParsedModule;
  options: Pick<CompilerOptions, 'output'>;
};

export const printModule = ({ moduleName, parsedModule, options }: PrintModuleOptions) => {
  const { output } = options;

  const relatedDeclarationsAsPrivate =
    (output?.relatedDeclarationsAsPrivate ?? false) && parsedModule.linkedParsedNodes.size > 0;
  const INTERNAL_IMPORT = `#internal/${moduleName}`;

  let moduleSource = ``;

  if (relatedDeclarationsAsPrivate) {
    moduleSource += ts.ScriptElementKindModifier.ambientModifier;
    moduleSource += ' ';
    moduleSource += ts.ScriptElementKind.moduleElement;
    moduleSource += ' ';
    moduleSource += `"${INTERNAL_IMPORT}"`;
    moduleSource += ' ';
    moduleSource += '{';
    moduleSource += ts.sys.newLine;

    parsedModule.linkedParsedNodes.forEach((linkedParsedNode) => {
      if (!linkedParsedNode.code) return;

      if (parsedModule.exportedParsedNodes.has(linkedParsedNode) && !relatedDeclarationsAsPrivate) {
        return;
      }

      const parentParsedNode = [...parsedModule.exportedParsedNodes].find(
        (node) => linkedParsedNode.parentParsedNode === node,
      );

      if (parentParsedNode) {
        parentParsedNode.code = parentParsedNode.code.replace(
          createRegexpIdentifier(linkedParsedNode.name),
          `import("${INTERNAL_IMPORT}").${linkedParsedNode.name}`,
        );
      }

      moduleSource += printParsedNode(linkedParsedNode);
      moduleSource += ts.sys.newLine;
    });

    moduleSource += '}';
    moduleSource += ts.sys.newLine;
  }

  moduleSource += ts.ScriptElementKindModifier.ambientModifier;
  moduleSource += ' ';
  moduleSource += ts.ScriptElementKind.moduleElement;
  moduleSource += ' ';
  moduleSource += `"${moduleName}"`;
  moduleSource += ' ';
  moduleSource += '{';
  moduleSource += ts.sys.newLine;

  const reExportsIdentifiers: string[] = [];

  if (parsedModule.reExportsFromExternalModules.size > 0) {
    parsedModule.reExportsFromExternalModules.forEach((externalModule, packageName) => {
      const importItem = {
        identifiers: [] as string[],
        defaultName: '',
        packageName: '',
        namespace: '',
      };

      externalModule.forEach(
        ({
          identifierNameExport,
          isDefaultImport,
          identifierNameImport,
          asNameExport,
          asNameImport,
          isNameSpaceImport,
        }) => {
          const reExportsIdentifier = asNameExport
            ? `${identifierNameExport} as ${asNameExport}`
            : identifierNameExport;

          if (!reExportsIdentifiers.includes(reExportsIdentifier)) {
            reExportsIdentifiers.push(reExportsIdentifier);
          }

          if (isDefaultImport) {
            importItem.defaultName = identifierNameImport;
          }

          if (isNameSpaceImport) {
            importItem.namespace = identifierNameImport;
          }

          if (!isDefaultImport) {
            const importIdentifier = asNameImport
              ? `${identifierNameImport} as ${asNameImport}`
              : identifierNameImport;

            if (!importItem.identifiers.includes(importIdentifier)) {
              importItem.identifiers.push(importIdentifier);
            }
          }
        },
      );

      importItem.packageName = packageName;

      if (!importItem.defaultName && !importItem.identifiers.length) return;

      if (importItem.namespace) {
        moduleSource += `import * as ${importItem.namespace} from ${packageName}`;
        moduleSource += ts.sys.newLine;
        return;
      }

      let clauses = '';

      if (importItem.defaultName) {
        clauses += importItem.defaultName;

        if (importItem.identifiers.length > 0) {
          clauses += ',';
          clauses += ' ';
        }
      }

      if (importItem.identifiers.length > 0) {
        clauses += `{ ${importItem.identifiers.join(', ')} }`;
      }

      moduleSource += `import ${clauses} from ${packageName}`;
      moduleSource += ts.sys.newLine;
    });
  }

  if (parsedModule.exportedParsedNodes.size > 0) {
    if (parsedModule.linkedParsedNodes.size > 0 && !relatedDeclarationsAsPrivate) {
      parsedModule.linkedParsedNodes.forEach((linkedParsedNode) => {
        if (!linkedParsedNode.code) return;

        if (parsedModule.exportedParsedNodes.has(linkedParsedNode)) return;

        linkedParsedNode.code = linkedParsedNode.code.replace(/export(\s?)/, '');

        moduleSource += printParsedNode(linkedParsedNode);
        moduleSource += ts.sys.newLine;
      });
    }

    parsedModule.exportedParsedNodes.forEach((parsedNode) => {
      if (!parsedNode.code) return;

      moduleSource += printParsedNode(parsedNode);
      moduleSource += ts.sys.newLine;
    });
  }

  if (reExportsIdentifiers.length > 0) {
    moduleSource += `export { ${reExportsIdentifiers.join(', ')} }`;
    moduleSource += ts.sys.newLine;
  }

  if (parsedModule.exportDefaultParsedNode) {
    moduleSource += parsedModule.exportDefaultParsedNode.code;
    moduleSource += ts.sys.newLine;
  }

  moduleSource += '}';

  return moduleSource;
};

export const printVariableDeclarationDefinition = ({
  identifierName,
  typeAnnotation,
  keyword,
  modifiers,
}: VariableDeclarationDefinition) => {
  let srcText = '';

  if (modifiers && modifiers.length > 0) {
    srcText += modifiers.join(' ');
    srcText += ' ';
  }

  srcText += keyword;
  srcText += ' ';
  srcText += identifierName;
  srcText += ':';
  srcText += ' ';
  srcText += typeAnnotation;

  return srcText;
};

export const printFunctionDeclarationDefinition = ({
  identifierName,
  parameters,
  returnType,
  keyword,
  modifiers,
  typeParameters,
}: FunctionDeclarationDefinition) => {
  let srcText = '';

  if (modifiers && modifiers.length > 0) {
    srcText += modifiers.join(' ');
    srcText += ' ';
  }

  srcText += keyword;
  srcText += ' ';
  srcText += identifierName;
  srcText += typeParameters;
  srcText += `(${parameters.join(', ')})`;
  srcText += ':';
  srcText += ' ';
  srcText += returnType;

  return srcText;
};

export const printClassDeclarationDefinition = ({
  identifierName,
  constructorParameters,
  members,
  heritageClauses,
  keyword,
  modifiers,
  typeParameters,
}: ClassDeclarationDefinition) => {
  let srcText = '';

  if (modifiers.length > 0) {
    srcText += modifiers.join(' ');
    srcText += ' ';
  }

  srcText += keyword;
  srcText += ' ';
  srcText += identifierName;
  srcText += typeParameters;
  srcText += ' ';

  if (heritageClauses.length > 0) {
    srcText += heritageClauses.join(' ');
    srcText += ' ';
  }

  srcText += '{';
  srcText += ts.sys.newLine;

  if (constructorParameters) {
    srcText += `constructor(${constructorParameters.join(', ')})`;
    srcText += ts.sys.newLine;
  }

  if (members.length > 0) {
    members.forEach((member) => {
      srcText += member;
      srcText += ts.sys.newLine;
    });
  }

  srcText += '}';

  return srcText;
};
