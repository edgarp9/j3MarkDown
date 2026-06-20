import { defineConfig } from "vite";

function getManualChunk(id: string): string | undefined {
  const normalizedId = id.replace(/\\/g, "/");

  if (!normalizedId.includes("/node_modules/")) {
    return undefined;
  }

  const legacyModeChunk = getLegacyCodeMirrorModeChunk(normalizedId);
  if (legacyModeChunk) {
    return legacyModeChunk;
  }

  const codeMirrorLanguageChunk = getCodeMirrorLanguageChunk(normalizedId);
  if (codeMirrorLanguageChunk) {
    return codeMirrorLanguageChunk;
  }

  const lezerLanguageChunk = getLezerLanguageChunk(normalizedId);
  if (lezerLanguageChunk) {
    return lezerLanguageChunk;
  }

  if (normalizedId.includes("/node_modules/@codemirror/")) {
    return "codemirror-core";
  }

  if (normalizedId.includes("/node_modules/@lezer/")) {
    return "lezer-core";
  }

  if (normalizedId.includes("/node_modules/codemirror/")) {
    return "codemirror-entry";
  }

  if (normalizedId.includes("/node_modules/prosemirror-")) {
    return "prosemirror";
  }

  if (normalizedId.includes("/node_modules/@milkdown/crepe/")) {
    return "milkdown-crepe";
  }

  if (normalizedId.includes("/node_modules/@milkdown/")) {
    return "milkdown";
  }

  if (normalizedId.includes("/node_modules/@tauri-apps/")) {
    return "tauri";
  }

  if (isMarkdownVendorModule(normalizedId)) {
    return "vendor-markdown";
  }

  if (
    normalizedId.includes("/node_modules/vue/") ||
    normalizedId.includes("/node_modules/@vue/")
  ) {
    return "vendor-vue";
  }

  if (normalizedId.includes("/node_modules/@floating-ui/")) {
    return "vendor-floating-ui";
  }

  if (normalizedId.includes("/node_modules/katex/")) {
    return "vendor-katex";
  }

  if (normalizedId.includes("/node_modules/lodash-es/")) {
    return "vendor-lodash";
  }

  if (normalizedId.includes("/node_modules/dompurify/")) {
    return "vendor-dompurify";
  }

  return "vendor-misc";
}

function getLegacyCodeMirrorModeChunk(normalizedId: string): string | undefined {
  const match = /\/node_modules\/@codemirror\/legacy-modes\/mode\/([^/.]+)/u.exec(normalizedId);

  if (!match) {
    return undefined;
  }

  return `codemirror-legacy-${match[1]}`;
}

function getCodeMirrorLanguageChunk(normalizedId: string): string | undefined {
  const match = /\/node_modules\/@codemirror\/(lang-[^/]+)/u.exec(normalizedId);

  if (!match) {
    return undefined;
  }

  return `codemirror-${match[1]}`;
}

function getLezerLanguageChunk(normalizedId: string): string | undefined {
  const match = /\/node_modules\/@lezer\/([^/]+)/u.exec(normalizedId);

  if (!match) {
    return undefined;
  }

  const languageName = match[1];

  if (["common", "highlight", "lr"].includes(languageName)) {
    return undefined;
  }

  return `lezer-${languageName}`;
}

function isMarkdownVendorModule(normalizedId: string): boolean {
  return [
    "/node_modules/bail/",
    "/node_modules/ccount/",
    "/node_modules/character-entities/",
    "/node_modules/comma-separated-tokens/",
    "/node_modules/decode-named-character-reference/",
    "/node_modules/devlop/",
    "/node_modules/escape-string-regexp/",
    "/node_modules/hast-util-",
    "/node_modules/is-plain-obj/",
    "/node_modules/longest-streak/",
    "/node_modules/markdown-table/",
    "/node_modules/mdast-util-",
    "/node_modules/micromark",
    "/node_modules/property-information/",
    "/node_modules/remark-",
    "/node_modules/space-separated-tokens/",
    "/node_modules/stringify-entities/",
    "/node_modules/trim-lines/",
    "/node_modules/trough/",
    "/node_modules/typedoc-github-wiki-theme/",
    "/node_modules/unified/",
    "/node_modules/unist-util-",
    "/node_modules/vfile",
    "/node_modules/zwitch/",
  ].some((marker) => normalizedId.includes(marker));
}

export default defineConfig({
  clearScreen: false,
  define: {
    __VUE_OPTIONS_API__: "false",
    __VUE_PROD_DEVTOOLS__: "false",
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: "false",
  },
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    rollupOptions: {
      output: {
        manualChunks: getManualChunk,
      },
    },
  },
});
