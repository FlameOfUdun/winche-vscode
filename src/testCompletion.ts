// Suggestions for .rules.test files. Pure: given the text, the cursor and the paired rules file's match
// patterns, says what fits at the cursor.

export interface TestSuggestion {
  label: string;
  /** A VS Code snippet (`${1:name}` placeholders); defaults to label. */
  snippet?: string;
  kind: "keyword" | "operation" | "path" | "snippet" | "function";
  detail?: string;
  info?: string;
}

export interface TestContext {
  where: "top" | "test" | "documents" | "afterExpect" | "afterOperation" | "afterPath" | "value" | "where";
  /** The operation on the current check line (afterOperation / afterPath). */
  operation?: string;
  /** The word being typed. */
  word: string;
  from: number;
}

const OPERATIONS = ["get", "list", "create", "update", "delete"];

/** Replaces strings and // comments with spaces (same length). */
function blank(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") { out += " "; i++; }
    } else if (c === "'" || c === '"') {
      out += c; i++;
      while (i < text.length && text[i] !== c && text[i] !== "\n") { out += " "; i += text[i] === "\\" ? 2 : 1; }
      if (i < text.length && text[i] === c) { out += c; i++; }
    } else { out += c; i++; }
  }
  return out.slice(0, text.length);
}

export function analyzeTest(text: string, pos: number): TestContext {
  const before = blank(text.slice(0, pos));
  // Which block is the cursor in: test { … }, documents { … }, or a value's braces inside them.
  const stack: ("test" | "documents" | "value")[] = [];
  let i = 0;
  while (i < before.length) {
    const rest = before.slice(i);
    const t = /^test\s+(['"])\s*\1\s*\{/.exec(rest) ?? /^test\s+(['"])[^\n]*?\1\s*\{/.exec(rest);
    const d = /^documents\s*\{/.exec(rest);
    const boundary = i === 0 || !/\w/.test(before[i - 1]);
    if (boundary && t) { stack.push("test"); i += t[0].length; continue; }
    if (boundary && d) { stack.push("documents"); i += d[0].length; continue; }
    if (before[i] === "{") stack.push("value");
    else if (before[i] === "}") stack.pop();
    i++;
  }

  const wordMatch = /[A-Za-z_][\w/.{}=*-]*$/.exec(before);
  const word = wordMatch ? wordMatch[0] : "";
  const from = pos - word.length;
  const line = before.slice(before.lastIndexOf("\n") + 1);
  const top = stack[stack.length - 1];

  if (top === "value") return { where: "value", word, from };
  if (top === "documents") return { where: "documents", word, from };
  if (top === undefined) return { where: "top", word, from };

  const check = /^\s*(allow|deny)\s+(\w*)(\s+(group\s+)?(\S*))?(\s+.*)?$/.exec(line);
  if (check) {
    const [, , op, afterOp, , path, tail] = check;
    if (afterOp === undefined) return { where: "afterExpect", word, from };
    if (tail === undefined) return { where: "afterOperation", operation: op, word, from };
    if (/\bwhere\b/.test(tail)) return { where: "where", operation: op, word, from };
    void path;
    return { where: "afterPath", operation: op, word, from };
  }
  return { where: "test", word, from };
}

/** Full match patterns in a rules file ("users/{uid}", "users/{uid}/notes/{id}"), outermost first. */
export function matchPatterns(rules: string): string[] {
  const text = blank(rules);
  const out: string[] = [];
  const stack: (string | null)[] = [];
  let i = 0;
  while (i < text.length) {
    const m = /^match\s+(\S+)\s*\{/.exec(text.slice(i));   // greedy: "users/{uid} {" and "users/{uid}{"
    if (m && (i === 0 || !/[\w.]/.test(text[i - 1]))) {
      const parent = [...stack].reverse().find((p): p is string => p !== null);
      const full = parent ? `${parent.replace(/\/+$/, "")}/${m[1].replace(/^\/+/, "")}` : m[1].replace(/^\/+/, "");
      stack.push(full);
      out.push(full);
      i += m[0].length;
      continue;
    }
    if (text[i] === "{") stack.push(null);
    else if (text[i] === "}") stack.pop();
    i++;
  }
  return out;
}

/** A pattern as a path snippet: users/{uid} → users/${1:uid}; {rest=**} → ${2:rest}. */
export function patternSnippet(pattern: string): string {
  let n = 0;
  return pattern.replace(/\{([A-Za-z_]\w*)(=\*\*)?\}/g, (_, name: string) => `\${${++n}:${name}}`);
}

/** Paths a check can use: documents for get/create/update/delete, collections (pattern minus its id) for list. */
export function pathSuggestions(patterns: string[], operation: string): TestSuggestion[] {
  const seen = new Set<string>();
  const out: TestSuggestion[] = [];
  for (const p of patterns) {
    let path = p;
    if (operation === "list") {
      const segments = p.split("/");
      if (segments.length < 2) continue;
      path = segments.slice(0, -1).join("/");
    }
    if (seen.has(path)) continue;
    seen.add(path);
    out.push({ label: path, snippet: patternSnippet(path), kind: "path", detail: operation === "list" ? "collection" : "document", info: `match ${p}` });
  }
  return out;
}

export function suggestTest(ctx: TestContext, patterns: string[]): TestSuggestion[] {
  switch (ctx.where) {
    case "top":
      return [
        { label: "test", snippet: 'test "${1:what it checks}" {\n\tauth { uid: \'${2:u1}\' }\n\t${3|allow,deny|} ${4|get,list,create,update,delete|} ${5:path}\n}', kind: "snippet", detail: "a test", info: "A named group of allow / deny checks" },
        { label: "documents", snippet: "documents {\n\t${1:teams/t1}: { ${2:active}: ${3:true} }\n}", kind: "snippet", detail: "shared documents", info: "What get() and exists() see, in every test" },
      ];
    case "test":
      return [
        { label: "allow", snippet: "allow ", kind: "keyword", detail: "expect allowed" },
        { label: "deny", snippet: "deny ", kind: "keyword", detail: "expect denied" },
        { label: "auth", snippet: "auth { uid: '${1:u1}' }", kind: "keyword", detail: "the caller's claims", info: "request.auth: uid plus every claim under token. Omit (or `auth none`) for signed out." },
        { label: "resource", snippet: "resource { ${1:field}: ${2:'value'} }", kind: "keyword", detail: "the existing document", info: "resource for the checks that follow" },
        { label: "time", snippet: "time timestamp('${1:2026-01-01T00:00:00Z}')", kind: "keyword", detail: "request.time" },
        { label: "documents", snippet: "documents {\n\t${1:teams/t1}: { ${2:active}: ${3:true} }\n}", kind: "keyword", detail: "this test's documents", info: "Added to the file's documents, for get() / exists()" },
      ];
    case "afterExpect":
      return OPERATIONS.map((op) => ({ label: op, snippet: `${op} `, kind: "operation" as const }));
    case "afterOperation":
      return [
        ...(ctx.operation === "list" ? [{ label: "group", snippet: "group ", kind: "keyword" as const, detail: "a collection group query" }] : []),
        ...pathSuggestions(patterns, ctx.operation ?? "get"),
      ];
    case "afterPath":
      if (ctx.operation === "create" || ctx.operation === "update")
        return [{ label: "with", snippet: "with { ${1:field}: ${2:'value'} }", kind: "keyword", detail: "the incoming document" }];
      if (ctx.operation === "list")
        return [{ label: "where", snippet: "where ${1:field} == ${2:'value'}", kind: "keyword", detail: "a query filter" }];
      return [];
    case "where":
      return [{ label: "&&", snippet: "&& ", kind: "keyword", detail: "another filter" }];
    case "value":
    case "documents":
      return [
        { label: "true", kind: "keyword" }, { label: "false", kind: "keyword" }, { label: "null", kind: "keyword" },
        { label: "timestamp", snippet: "timestamp('${1:2026-01-01T00:00:00Z}')", kind: "function", detail: "a timestamp" },
        { label: "path", snippet: "path('${1}')", kind: "function", detail: "a path value" },
        { label: "bytes", snippet: "bytes('${1}')", kind: "function", detail: "base64 bytes" },
      ];
  }
}
