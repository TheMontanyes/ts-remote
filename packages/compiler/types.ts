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
};

export type ParsedModule = {
  reExportsFromExternalModules: Map<string, ReExportModule[]>;
  exportedParsedNodes: Set<ParsedNode>;
  linkedParsedNodes: Set<ParsedNode>;
  exportDefaultParsedNode?: ParsedNode;
};

export type ImportPath = string;
export type ModuleName = string;

/**
 * A list in key-value format, where the key is the name of the declared module, and the value is the path to the entry point
 * */
export type ModuleList = Record<ModuleName, ImportPath>;

export type CompilerOptions = {
  /**
   * A list in key-value format, where the key is the name of the declared module, and the value is the path to the entry point
   * */
  moduleList: ModuleList;
  /**
   * d.ts files required for environment and concatenation with output.filename
   * */
  additionalDeclarations?: string[];
  output?: {
    /**
     * The path to the compiled file
     * @default path.resolve(process.cwd(), '@types', 'types.d.ts')
     * */
    filename?: string;
    /**
     * A method for processing the contents of a compiled file
     * */
    format?: (result: string) => string;
  };
  /**
   * The path to tsconfig
   * @default path.resolve(process.cwd(), 'tsconfig.json')
   * */
  tsconfig?: string;
};
