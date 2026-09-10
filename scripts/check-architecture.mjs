import { readdirSync, readFileSync } from "node:fs";
import { resolve, relative, dirname, join } from "node:path";
import ts from "typescript";

const root = resolve(process.argv[2] ?? '.');
const files = [];
function visit(dir) {
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, item.name);
    if (item.isDirectory()) visit(path);
    else if (item.name.endsWith('.ts')) files.push(path);
  }
}
visit(join(root, 'src'));
const errors = [];
for (const file of files) {
  const name = relative(root, file).replaceAll('\\', '/');
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  function inspect(node) {
    let value;
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) value = node.moduleSpecifier.text;
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) value = node.argument.literal.text;
    if (value) {
      const target = value.startsWith('.') ? relative(root, resolve(dirname(file), value)).replaceAll('\\', '/') : value;
      const owner = name.match(/^src\/modules\/([^/]+)\//)?.[1];
      const dependency = target.match(/^src\/modules\/([^/]+)\//)?.[1];
      if (owner && /^(src\/(adapters|entrypoints|bootstrap|workers)\/)/.test(target)) errors.push(`${name}: core depends on implementation ${target}`);
      if (dependency && owner !== dependency && target !== `src/modules/${dependency}/index.js`) errors.push(`${name}: cross-module private import ${target}`);
      if (name.includes('/domain/') && (/^(node:(fs|http|https|sqlite|child_process)|@earendil-works\/pi|@langchain\/)/.test(target) || target.includes('/application/'))) errors.push(`${name}: domain depends on IO/application ${target}`);
      if (name.startsWith('src/entrypoints/admin-http/') && target.startsWith('src/adapters/')) errors.push(`${name}: admin depends on adapter ${target}`);
    }
    ts.forEachChild(node, inspect);
  }
  inspect(source);
}
if (errors.length) { process.stderr.write(errors.join('\n') + '\n'); process.exitCode = 1; }
else process.stdout.write(`Architecture boundaries passed (${files.length} source files).\n`);
