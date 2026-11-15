import * as fs from "fs";
import * as path from "path";
import { beforeAll, describe, expect, it } from "vitest";
import * as oniguruma from "vscode-oniguruma";
import { INITIAL, IGrammar, Registry } from "vscode-textmate";

// Tokenizes with VS Code's own TextMate engine and checks the scope each piece of text gets.

let rules: IGrammar;
let tests: IGrammar;

beforeAll(async () => {
  const wasm = fs.readFileSync(path.join(__dirname, "../node_modules/vscode-oniguruma/release/onig.wasm"));
  await oniguruma.loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer);
  const registry = new Registry({
    onigLib: Promise.resolve({
      createOnigScanner: (p: string[]) => new oniguruma.OnigScanner(p),
      createOnigString: (s: string) => new oniguruma.OnigString(s),
    }),
    loadGrammar: async (scope) => {
      const file = scope === "source.winche-rules" ? "winche-rules" : "winche-rules-test";
      return JSON.parse(fs.readFileSync(path.join(__dirname, `../syntaxes/${file}.tmLanguage.json`), "utf8"));
    },
  });
  rules = (await registry.loadGrammar("source.winche-rules"))!;
  tests = (await registry.loadGrammar("source.winche-rules-test"))!;
});

/** [text, innermost scope] for every token of every line. */
function tokens(grammar: IGrammar, text: string): [string, string][] {
  const out: [string, string][] = [];
  let state = INITIAL;
  for (const line of text.split("\n")) {
    const r = grammar.tokenizeLine(line, state);
    for (const t of r.tokens) {
      const s = line.slice(t.startIndex, t.endIndex);
      if (s.trim()) out.push([s.trim(), t.scopes[t.scopes.length - 1]]);
    }
    state = r.ruleStack;
  }
  return out;
}

/** The scope of the first token whose text is `piece` (after `after`, if given). */
function scopeOf(grammar: IGrammar, text: string, piece: string, nth = 0): string | undefined {
  return tokens(grammar, text).filter(([t]) => t === piece)[nth]?.[1];
}

describe("rules grammar", () => {
  const src = `// comment
match users/{uid}/files/{rest=**} {
  allow read, write: if request.auth.uid == uid
    && request.auth.token.role in ['admin', "staff"]
    && request.resource.data.keys().hasOnly(['name'])
    && resource.size is int
    && !(resource.public == true) && exists(path('teams/t1'));
  allow get;
}`;

  it("colours match paths and their captures", () => {
    expect(scopeOf(rules, src, "match")).toBe("keyword.control.match.winche");
    expect(scopeOf(rules, src, "users")).toBe("string.unquoted.path.winche");
    expect(scopeOf(rules, src, "uid")).toBe("variable.parameter.capture.winche");
    expect(scopeOf(rules, src, "rest")).toBe("variable.parameter.capture.winche");
    expect(scopeOf(rules, src, "=**")).toBe("keyword.operator.wildcard.winche");
  });

  it("colours allow and its operations", () => {
    expect(scopeOf(rules, src, "allow")).toBe("keyword.control.allow.winche");
    expect(scopeOf(rules, src, "read")).toBe("storage.modifier.operation.winche");
    expect(scopeOf(rules, src, "write")).toBe("storage.modifier.operation.winche");
    expect(scopeOf(rules, src, "get")).toBe("storage.modifier.operation.winche");
    expect(scopeOf(rules, src, "if")).toBe("keyword.control.conditional.winche");
  });

  it("colours in and is as keywords, and the type after is", () => {
    expect(scopeOf(rules, src, "in")).toBe("keyword.operator.expression.in.winche");
    expect(scopeOf(rules, src, "is")).toBe("keyword.operator.expression.is.winche");
    expect(scopeOf(rules, src, "int")).toBe("support.type.primitive.winche");
  });

  it("tells variables, properties, methods and functions apart", () => {
    expect(scopeOf(rules, src, "request")).toBe("variable.language.winche");
    expect(scopeOf(rules, src, "resource", 1)).toBe("variable.language.winche");    // the bare one, line 6
    expect(scopeOf(rules, src, "auth")).toBe("variable.other.property.winche");
    expect(scopeOf(rules, src, "resource")).toBe("variable.other.property.winche");  // request.resource
    expect(scopeOf(rules, src, "uid", 2)).toBe("variable.other.readwrite.winche");   // the capture in the condition
    expect(scopeOf(rules, src, "keys")).toBe("entity.name.function.member.winche");
    expect(scopeOf(rules, src, "hasOnly")).toBe("entity.name.function.member.winche");
    expect(scopeOf(rules, src, "exists")).toBe("support.function.winche");
    expect(scopeOf(rules, src, "path")).toBe("support.function.winche");
  });

  it("colours literals, operators and comments", () => {
    expect(scopeOf(rules, src, "admin")).toBe("string.quoted.single.winche");
    expect(scopeOf(rules, src, "staff")).toBe("string.quoted.double.winche");
    expect(scopeOf(rules, src, "true")).toBe("constant.language.winche");
    expect(scopeOf(rules, src, "==")).toBe("keyword.operator.comparison.winche");
    expect(scopeOf(rules, src, "&&")).toBe("keyword.operator.logical.winche");
    expect(scopeOf(rules, src, "!")).toBe("keyword.operator.logical.winche");
    expect(scopeOf(rules, src, "comment")).toBe("comment.line.double-slash.winche");
  });

  it("colours the readable forms, and leaves the bare words as names", () => {
    const t = tokens(rules, "match d/{id} { allow update: if changes only ['a'] && request.resource.data has any ['b'] && 'c' not in resource.tags && has == changes; }");
    const scopes = (w: string) => t.filter(([s]) => s === w).map(([, sc]) => sc);
    expect(scopes("changes")).toEqual(["keyword.operator.expression.changes.winche", "variable.other.readwrite.winche"]);
    expect(scopes("only")).toEqual(["keyword.operator.expression.changes.winche"]);
    expect(scopes("has")).toEqual(["keyword.operator.expression.has.winche", "variable.other.readwrite.winche"]);
    expect(scopes("any")).toEqual(["keyword.operator.expression.has.winche"]);
    expect(scopes("not")).toEqual(["keyword.operator.expression.not.winche"]);
    expect(scopes("in")).toEqual(["keyword.operator.expression.in.winche"]);
  });

  it("colours functions, lets, returns and built paths", () => {
    const src2 = `function isMember(project, user) {
  let p = /projects/$(project)/members/$(user);
  return exists(p) && get(/databases/$(database)/documents/teams/t1).open == true;
}
match projects/{id} {
  allow get: if isMember(id, request.auth.uid);
}`;
    const t = tokens(rules, src2);
    const scope = (w: string, n = 0) => t.filter(([s]) => s === w)[n]?.[1];
    expect(scope("function")).toBe("storage.type.function.winche");
    expect(scope("isMember")).toBe("entity.name.function.definition.winche");
    expect(scope("project")).toBe("variable.parameter.function.winche");
    expect(scope("let")).toBe("storage.type.let.winche");
    expect(scope("p")).toBe("variable.other.definition.winche");
    expect(scope("=")).toBe("keyword.operator.assignment.winche");
    expect(scope("return")).toBe("keyword.control.return.winche");
    expect(scope("/projects")).toBe("string.unquoted.path.winche");
    expect(scope("/members")).toBe("string.unquoted.path.winche");
    expect(scope("project", 1)).toBe("variable.other.readwrite.winche");    // inside $( )
    expect(scope("$")).toBe("punctuation.definition.interpolation.begin.winche");
    expect(scope("/teams")).toBe("string.unquoted.path.winche");
    expect(scope("/t1")).toBe("string.unquoted.path.winche");
    expect(scope("isMember", 1)).toBe("support.function.winche");            // the call
    expect(scope("==")).toBe("keyword.operator.comparison.winche");
  });

  it("doesn't mistake a type name used as a function", () => {
    const t = tokens(rules, "match a/{b} { allow read: if request.time < timestamp('2027-01-01T00:00:00Z'); }");
    expect(t.find(([s]) => s === "timestamp")?.[1]).toBe("support.function.winche");
  });
});

describe("test grammar", () => {
  const src = `documents {
  teams/t1: { active: true }
}

test "owners read" {
  auth { uid: 'u1', role: "staff", n: -3 }
  time timestamp('2026-01-01T00:00:00Z')
  allow get users/u1
  deny create users/u1 with { name: 'Ann', admin: true }   // why
  allow list group comments where authorId == 'u1' && n > 2
  auth none
}`;

  it("colours tests, checks and paths", () => {
    expect(scopeOf(tests, src, "test")).toBe("keyword.control.test.winche");
    expect(scopeOf(tests, src, '"owners read"')).toBe("entity.name.function.test.winche");
    expect(scopeOf(tests, src, "allow")).toBe("keyword.control.expect.winche");
    expect(scopeOf(tests, src, "deny")).toBe("keyword.control.expect.winche");
    expect(scopeOf(tests, src, "get")).toBe("storage.modifier.operation.winche");
    expect(scopeOf(tests, src, "users")).toBe("string.unquoted.path.winche");
    expect(scopeOf(tests, src, "group")).toBe("keyword.other.group.winche");
    expect(scopeOf(tests, src, "comments")).toBe("string.unquoted.path.winche");
    expect(scopeOf(tests, src, "teams")).toBe("string.unquoted.path.winche");
  });

  it("colours setup, keywords, keys and values", () => {
    expect(scopeOf(tests, src, "documents")).toBe("keyword.other.setup.winche");
    expect(scopeOf(tests, src, "auth")).toBe("keyword.other.setup.winche");
    expect(scopeOf(tests, src, "time")).toBe("keyword.other.setup.winche");
    expect(scopeOf(tests, src, "none")).toBe("constant.language.none.winche");
    expect(scopeOf(tests, src, "with")).toBe("keyword.other.with.winche");
    expect(scopeOf(tests, src, "where")).toBe("keyword.other.where.winche");
    expect(scopeOf(tests, src, "authorId")).toBe("variable.other.property.winche");
    expect(scopeOf(tests, src, "uid")).toBe("variable.other.property.winche");
    expect(scopeOf(tests, src, "active")).toBe("variable.other.property.winche");
    expect(scopeOf(tests, src, "u1")).toBe("string.quoted.single.winche");
    expect(scopeOf(tests, src, "u1", 1)).toBe("string.unquoted.path.winche");
    expect(scopeOf(tests, src, "-3")).toBe("constant.numeric.winche");
    expect(scopeOf(tests, src, "true")).toBe("constant.language.winche");
    expect(scopeOf(tests, src, "timestamp")).toBe("support.function.winche");
    expect(scopeOf(tests, src, "&&")).toBe("keyword.operator.logical.winche");
    expect(scopeOf(tests, src, "==")).toBe("keyword.operator.comparison.winche");
    expect(scopeOf(tests, src, "why")).toBe("comment.line.double-slash.winche");
  });
});
