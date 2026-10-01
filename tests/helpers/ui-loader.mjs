// Node's built-in runner does not resolve Next aliases or TSX. Feature tests still
// own their existing Auth/transport mocks; this loads the actual shared UI.
import { registerHooks } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import ts from "typescript";

const root = new URL("../../src/", import.meta.url);
const isShared = (url = "") => ["components/", "lib/localization/"].some((path) => url.startsWith(new URL(path, root).href));
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith("@/components/") || specifier.startsWith("@/lib/localization/") ||
      (isShared(context.parentURL) && specifier.startsWith("./"))) {
      const base = specifier.startsWith("@/") ? new URL(specifier.slice(2), root) : new URL(specifier, context.parentURL);
      for (const ext of [".ts", ".tsx"]) {
        const url = new URL(base.href + ext);
        if (existsSync(url)) return { url: url.href, shortCircuit: true };
      }
    }
    if (isShared(context.parentURL) && specifier === "next/navigation") return next("next/navigation.js", context);
    return next(specifier, context);
  },
  load(url, context, next) {
    if (isShared(url) && url.endsWith(".tsx")) return {
      format: "module", shortCircuit: true,
      source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
        compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext },
      }).outputText,
    };
    return next(url, context);
  },
});
