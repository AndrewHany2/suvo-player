const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Per-platform screen variant resolution (Tier 5 bundle trim). Both web and
  // webOS-TV build with `expo export --platform web`, so Metro can't select
  // .tv via its platform extension. The TV build sets EXPO_PUBLIC_TV=1
  // (package.json build:tv); here we swap each screen's canonical .web specifier
  // to its .tv sibling so only the TV screen tree is resolved — and therefore
  // bundled. The web/electron build leaves the flag unset and keeps .web, so the
  // .tv screens are never resolved and drop out of that bundle (works even under
  // web.output:single, where dynamic import() can't code-split).
  if (process.env.EXPO_PUBLIC_TV === '1') {
    const m = moduleName.match(/^(.*\/screens\/)(LiveTVScreen|MoviesScreen|SeriesScreen|HistoryScreen)\.web$/);
    if (m) {
      return context.resolveRequest(context, `${m[1]}${m[2]}.tv`, platform);
    }
    if (/\/screens\/AccountsScreen$/.test(moduleName)) {
      return context.resolveRequest(context, `${moduleName}.tv`, platform);
    }
  }
  // Force CJS bundle for supabase to avoid dynamic import(variable) in .mjs
  if (moduleName === '@supabase/supabase-js') {
    return {
      filePath: path.resolve(__dirname, 'node_modules/@supabase/supabase-js/dist/index.cjs'),
      type: 'sourceFile',
    };
  }
  // Stub out OpenTelemetry — not needed in React Native
  if (moduleName === '@opentelemetry/api') {
    return {
      filePath: path.resolve(__dirname, 'mocks/opentelemetry-api.js'),
      type: 'sourceFile',
    };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
