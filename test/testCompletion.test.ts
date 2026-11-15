import { describe, expect, it } from "vitest";
import { analyzeTest, matchPatterns, pathSuggestions, patternSnippet, suggestTest } from "../src/testCompletion";

/** The text with `|` marking the cursor. */
function at(textWithCursor: string) {
  const pos = textWithCursor.indexOf("|");
  return analyzeTest(textWithCursor.replace("|", ""), pos);
}

const labels = (text: string, patterns: string[] = []) => suggestTest(at(text), patterns).map((s) => s.label);

describe("analyzeTest", () => {
  it("knows the top level, a test and a documents block", () => {
    expect(at("|").where).toBe("top");
    expect(at('test "a" {\n  |\n}').where).toBe("test");
    expect(at("documents {\n  |\n}").where).toBe("documents");
    expect(at('test "a" {\n  auth { uid: | }\n}').where).toBe("value");
    expect(at('test "a" { deny get a/b }\n|').where).toBe("top");
  });

  it("follows a check line", () => {
    expect(at('test "a" {\n  allow |').where).toBe("afterExpect");
    expect(at('test "a" {\n  allow ge|').word).toBe("ge");
    const op = at('test "a" {\n  deny create |');
    expect(op.where).toBe("afterOperation");
    expect(op.operation).toBe("create");
    expect(at('test "a" {\n  deny create users/u1 |').where).toBe("afterPath");
    expect(at('test "a" {\n  allow list notes where ownerId == \'u1\' |').where).toBe("where");
  });

  it("ignores braces and keywords inside strings and comments", () => {
    expect(at('test "a { b" {\n  // test "x" {\n  |').where).toBe("test");
  });
});

describe("suggestTest", () => {
  it("offers test and documents at the top", () => {
    expect(labels("|")).toEqual(["test", "documents"]);
  });

  it("offers checks and setup inside a test", () => {
    expect(labels('test "a" {\n  |')).toEqual(["allow", "deny", "auth", "resource", "time", "documents"]);
  });

  it("offers operations, then paths from the rules' match patterns", () => {
    expect(labels('test "a" {\n  allow |')).toEqual(["get", "list", "create", "update", "delete"]);
    const patterns = ["users/{uid}", "users/{uid}/notes/{id}"];
    expect(labels('test "a" {\n  allow get |', patterns)).toEqual(["users/{uid}", "users/{uid}/notes/{id}"]);
    expect(labels('test "a" {\n  allow list |', patterns)).toEqual(["group", "users", "users/{uid}/notes"]);
  });

  it("offers with for writes and where for lists", () => {
    expect(labels('test "a" {\n  allow update users/u1 |')).toEqual(["with"]);
    expect(labels('test "a" {\n  allow list notes |')).toEqual(["where"]);
    expect(labels('test "a" {\n  allow get users/u1 |')).toEqual([]);
  });
});

describe("match patterns", () => {
  it("joins nested matches and skips comments", () => {
    expect(matchPatterns(`
      // match nope/{x} {
      match users/{uid} {
        allow read;
        match notes/{id} { allow read; }
      }
      match {path=**}/comments/{c} { allow list; }
    `)).toEqual(["users/{uid}", "users/{uid}/notes/{id}", "{path=**}/comments/{c}"]);
  });

  it("turns captures into snippet placeholders", () => {
    expect(patternSnippet("users/{uid}/files/{rest=**}")).toBe("users/${1:uid}/files/${2:rest}");
    expect(pathSuggestions(["{doc=**}"], "list")).toEqual([]);   // no collection to list
  });
});
