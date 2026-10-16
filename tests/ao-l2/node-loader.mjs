import '../helpers/ui-loader.mjs';
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
const feature = new URL('../../src/features/activities-opportunities/', import.meta.url).href;
// Extend the existing TSX test loader only for AO's parent-relative imports.
registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.startsWith(feature) && specifier.startsWith('../')) {
    for (const extension of ['.ts', '.tsx']) {
      const url = new URL(specifier + extension, context.parentURL);
      if (existsSync(url)) return { url: url.href, shortCircuit: true };
    }
  }
  return next(specifier, context);
} });
