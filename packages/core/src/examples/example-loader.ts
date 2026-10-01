import ts from 'typescript';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Transpile a component tree into a temporary ESM directory so that example
 * modules (which import source using `.js` specifiers, ESM-style) can load
 * real component code without a separate bundling step.
 */
export async function transpileComponentTree(
  srcDir: string,
  outDir: string,
): Promise<void> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(srcDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === 'dist') continue;
    const src = path.join(srcDir, e.name);
    const out = path.join(outDir, e.name);
    if (e.isDirectory()) {
      await transpileComponentTree(src, out);
    } else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) {
      const code = await fs.readFile(src, 'utf8');
      const res = ts.transpileModule(code, {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ES2022,
        },
        fileName: src,
      });
      await fs.mkdir(path.dirname(out), { recursive: true });
      await fs.writeFile(out.replace(/\.ts$/, '.js'), res.outputText);
    }
  }
}

/**
 * Rewrite example source so relative imports that target the component
 * package (e.g. `../../src/index.js`) resolve into the transpiled runtime
 * directory. Example-local relative imports are left untouched.
 */
export function rewriteExampleImports(
  code: string,
  exampleFile: string,
  componentRoot: string,
  runtimeDir: string,
): string {
  const exampleDir = path.dirname(exampleFile);
  return code.replace(
    /from\s+["'](\.[^"']+)["']/g,
    (whole, spec: string) => {
      const resolved = path.resolve(exampleDir, spec);
      const relToRoot = path.relative(componentRoot, resolved);
      if (!relToRoot.startsWith('..') && !path.isAbsolute(relToRoot)) {
        const target = path
          .join(runtimeDir, relToRoot)
          .replace(/\.ts$/, '.js');
        return `from ${JSON.stringify(pathToFileUrl(target))}`;
      }
      return whole;
    },
  );
}

function pathToFileUrl(p: string): string {
  return pathToFileURL(path.resolve(p)).href;
}
