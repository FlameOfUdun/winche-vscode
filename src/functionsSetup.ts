/** What a winche.json says about functions, and whether Deno's VS Code settings cover them (no vscode API: testable). */

/** The functions folder a winche.json names (`"functions": "functions"`), relative to it; null when it names none. */
export function functionsFolder(wincheJson: string): string | null {
  try {
    const config = JSON.parse(wincheJson) as { functions?: unknown };
    return typeof config.functions === "string" && config.functions.trim() ? config.functions.trim().replace(/\\/g, "/").replace(/\/+$/, "") : null;
  } catch {
    return null;
  }
}

/** A path relative to the workspace folder, with forward slashes and no "./" (what deno.enablePaths holds). */
export function relativeTo(root: string, target: string): string | null {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
  const r = norm(root), t = norm(target);
  if (t === r) return ".";
  return t.startsWith(r + "/") ? t.slice(r.length + 1) : null;
}

/**
 * Whether Deno already checks the folder: Deno on for the whole workspace (and no enablePaths narrowing it), or the
 * folder (or one above it) in deno.enablePaths.
 */
export function denoCovers(folder: string, enable: boolean | undefined, enablePaths: string[] | undefined): boolean {
  const paths = (enablePaths ?? []).map((p) => p.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, ""));
  if (paths.length === 0) return enable === true;
  return paths.some((p) => p === "." || p === "" || folder === p || folder.startsWith(p + "/"));
}

/** deno.enablePaths with the folder added (kept as it was otherwise). */
export function withFolder(enablePaths: string[] | undefined, folder: string): string[] {
  const paths = [...(enablePaths ?? [])];
  return paths.includes(folder) ? paths : [...paths, folder];
}
