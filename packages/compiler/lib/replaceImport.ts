export const replaceImport = (text: string) =>
  text.replace(
    /import\(['"](?:(?!node_modules).)*?['"]\)\.?|(?<=import\(['"]).*?node_modules\/@types\/((?:(?!(?:['"\/\)])).)*)(?:(?!['"]\)).)*|(?<=import\(['"]).*?node_modules\/((?:.(?!(?:index|['"\)])))*[^\/])(?:(?!['"]\)).)*/gm,
    '$1$2',
  );
