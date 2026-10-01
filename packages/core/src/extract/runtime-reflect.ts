import ts from 'typescript';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import os from 'node:os';

export interface RuntimeProp {
  name: string;
  runtimeType: string;
  required: boolean;
  hasDefault: boolean;
  defaultValue?: unknown;
}

export interface RuntimeEvent {
  name: string;
}

export interface RuntimeComponent {
  name: string;
  description?: string;
  props: RuntimeProp[];
  events: RuntimeEvent[];
}

/**
 * Runtime reflection: actually import the built components and read their
 * metadata. This catches what static analysis cannot (evaluated defaults,
 * factory-produced configs) but cannot provide slots, JSDoc or full static
 * types. Reflection runs in a throwaway directory and later inside a worker.
 */
export async function runtimeReflectPackage(
  rootDir: string,
  entryFile = path.join(rootDir, 'index.ts'),
): Promise<RuntimeComponent[]> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'compodoc-runtime-'));
  try {
    await transpileTree(rootDir, tmp);
    const entryRel = path
      .relative(rootDir, entryFile)
      .replace(/\.ts$/, '.js');
    const modUrl = pathToFileURL(path.join(tmp, entryRel)).href;
    const mod = await import(`${modUrl}?t=${Date.now()}`);
    const out: RuntimeComponent[] = [];
    for (const value of Object.values(mod)) {
      const c = value as {
        name?: unknown;
        description?: unknown;
        __props?: Record<
          string,
          {
            type?: unknown;
            required?: boolean;
            default?: unknown;
          }
        >;
        emits?: string[];
      };
      if (!c || typeof c.name !== 'string' || !c.__props) continue;
      out.push({
        name: c.name,
        description:
          typeof c.description === 'string' ? c.description : undefined,
        props: Object.entries(c.__props).map(([name, spec]) => {
          const hasDefault =
            Object.prototype.hasOwnProperty.call(spec, 'default');
          let defaultValue: unknown;
          if (hasDefault) {
            const d = spec.default;
            // Functions in this DSL are default-value factories.
            try {
              defaultValue = typeof d === 'function' ? d() : d;
            } catch {
              defaultValue = undefined;
            }
          }
          return {
            name,
            runtimeType: typeNameOf(spec.type),
            required: spec.required === true,
            hasDefault,
            defaultValue,
          };
        }),
        events: Array.isArray(c.emits) ? c.emits.map((name) => ({ name })) : [],
      });
    }
    return out;
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

function typeNameOf(t: unknown): string {
  if (t === String) return 'string';
  if (t === Number) return 'number';
  if (t === Boolean) return 'boolean';
  if (Array.isArray(t)) return 'union';
  if (t === Object || t === undefined || t === null) return 'unknown';
  return 'unknown';
}

async function transpileTree(srcDir: string, outDir: string): Promise<void> {
  const entries = await fs.readdir(srcDir, { withFileTypes: true });
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === 'dist') continue;
    const src = path.join(srcDir, e.name);
    const out = path.join(outDir, e.name);
    if (e.isDirectory()) {
      await transpileTree(src, out);
    } else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) {
      const code = await fs.readFile(src, 'utf8');
      let res: ts.TranspileOutput;
      try {
        res = ts.transpileModule(code, {
          compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.ES2022,
          },
          fileName: src,
          reportDiagnostics: true,
        });
      } catch (e) {
        throw new Error(`transpile crashed for ${src}: ${(e as Error).message}`);
      }
      const fatal = res.diagnostics?.find(
        (d) => d.category === ts.DiagnosticCategory.Error,
      );
      if (fatal) {
        throw new Error(
          `failed to transpile ${src}: ${ts.flattenDiagnosticMessageText(
            fatal.messageText,
            '\n',
          )}`,
        );
      }
      await fs.mkdir(path.dirname(out), { recursive: true });
      await fs.writeFile(out.replace(/\.ts$/, '.js'), res.outputText);
    }
  }
}
