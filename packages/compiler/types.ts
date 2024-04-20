import ts from 'typescript';

export type VariableDeclarationDefinition = {
  keyword: ts.ScriptElementKind.constElement;
  typeAnnotation: string;
  identifierName: string;
  modifiers: string[];
};

export type FunctionDeclarationDefinition = {
  keyword: ts.ScriptElementKind.functionElement | `${ts.ScriptElementKind.functionElement}*`;
  parameters: string[];
  typeParameters: string;
  returnType: string;
  identifierName: string | '__anonymous';
  modifiers: string[];
};

export type ClassDeclarationDefinition = {
  keyword: ts.ScriptElementKind.classElement;
  constructorParameters: string[];
  members: string[];
  identifierName: string | '__anonymous';
  heritageClauses: string[];
  modifiers: string[];
  typeParameters: string;
};

export type ParsedNode = {
  name: string;
  jsDoc: string;
  code: string;
  linkedNodes: ts.Node[];
  astNode: ts.Node;
};

export type ReExportModule = {
  identifierNameExport: string;
  identifierNameImport: string;
  isDefaultImport?: boolean;
  isNameSpaceImport?: boolean;
  asNameExport?: string;
  asNameImport?: string;
  isTypeOnlyExport?: boolean;
};

export type ParsedModule = {
  reExportsFromExternalModules: Map<string, ReExportModule[]>;
  exportedParsedNodes: Set<ParsedNode>;
  exportedIdentifiersTypeOnly: Set<string>;
  linkedParsedNodes: Set<ParsedNode>;
  exportDefaultParsedNode?: ParsedNode;
};

type ImportPath = string;

type ModuleList = {
  [moduleName: string]: ImportPath;
};

export type CompileOptions = {
  moduleList: ModuleList;
  additionalDeclarations?: string[];
  output: {
    filename?: string;
    format?: (result: string) => string;
  };
  tsconfig?: string;
};
