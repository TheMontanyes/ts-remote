import {
  ClassDeclarationDefinition,
  CompilerOptions,
  FunctionDeclarationDefinition,
  ParsedModule,
  ParsedNode,
  VariableDeclarationDefinition,
} from './types';
import ts from 'typescript';

const printParsedNode = ({ code, jsDoc }: ParsedNode) => {
  let result = '';

  if (jsDoc) {
    result += jsDoc;
    result += ts.sys.newLine;
  }

  result += code;

  return result;
};

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
  compilerOptions: CompilerOptions;
};

export const printModule = ({ moduleName, parsedModule, compilerOptions }: PrintModuleOptions) => {
  const { output } = compilerOptions;
  const isDTSOutput = output.filename?.endsWith('.d.ts');

  let moduleSource = ``;

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
          reExportsIdentifiers.push(
            asNameExport ? `${identifierNameExport} as ${asNameExport}` : identifierNameExport,
          );

          if (isDefaultImport) {
            importItem.defaultName = identifierNameImport;
          }

          if (isNameSpaceImport) {
            importItem.namespace = identifierNameImport;
          }

          importItem.identifiers.push(
            asNameImport ? `${identifierNameImport} as ${asNameImport}` : identifierNameImport,
          );
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

  if (parsedModule.linkedParsedNodes.size > 0) {
    if (isDTSOutput) {
      moduleSource += '{';
      moduleSource += ts.sys.newLine;
    }

    parsedModule.linkedParsedNodes.forEach((linkedParsedNode) => {
      if (!linkedParsedNode.code) return;

      if (parsedModule.exportedParsedNodes.has(linkedParsedNode)) return;

      linkedParsedNode.code = linkedParsedNode.code.replace('export ', '');

      moduleSource += printParsedNode(linkedParsedNode);
      moduleSource += ts.sys.newLine;
    });

    if (isDTSOutput) {
      moduleSource += '}';
      moduleSource += ts.sys.newLine;
    }
  }

  if (parsedModule.exportedParsedNodes.size > 0) {
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
