import { describe as group, expect, it } from "vitest";
import { describe } from "../src/rulesCompletion";

/** Hover info at `|` (the cursor may sit anywhere in the word). */
function hover(textWithCursor: string, subsystem: "database" | "storage" = "database") {
  const pos = textWithCursor.indexOf("|");
  return describe(textWithCursor.replace("|", ""), pos, subsystem);
}

const rule = (condition: string) => `match users/{uid} {\n  allow read: if ${condition};\n}`;

group("hover follows the dotted chain", () => {
  it("knows request's members and auth's", () => {
    expect(hover(rule("request.au|th != null"))?.detail).toBe("the caller's claims");
    expect(hover(rule("request.auth.u|id == uid"))?.info).toContain("uid");
    expect(hover(rule("request.auth.tok|en.sub == uid"))?.detail).toBe("map");
    expect(hover(rule("request.auth.token.s|ub == uid"))?.info).toContain("subject");
    expect(hover(rule("request.auth.token.ro|le == 'admin'"))?.info).toBe("The token's `role` claim");
    expect(hover(rule("request.ti|me < timestamp('2027-01-01T00:00:00Z')"))?.detail).toBe("timestamp");
    expect(hover(rule("request.meth|od == 'get'"))?.info).toContain("create");
    expect(hover(rule("request.resou|rce.name is string"))?.detail).toBe("the document after the write");
  });

  it("knows document columns and fields", () => {
    expect(hover(rule("resource.da|ta.keys().size() > 0"))?.detail).toBe("the fields alone");
    expect(hover(rule("resource.createdA|t < request.time"))?.detail).toBe("timestamp");
    expect(hover(rule("request.resource.ver|sion == 1"))?.info).toContain("every write");
    expect(hover(rule("resource.owner|Id == request.auth.uid"))?.info).toBe("A field — the existing document's `ownerId`");
    expect(hover(rule("request.resource.data.addr|ess.city == 'x'"))?.info).toBe("A field — the incoming document's `address`");
    expect(hover(rule("resource.mimeTy|pe == 'image/png'"), "storage")?.detail).toBe("string");
  });

  it("knows methods, globals and path captures", () => {
    expect(hover(rule("request.resource.data.keys().hasOn|ly(['a'])"))?.detail).toBe("list → bool");
    expect(hover(rule("request.resource.data.ke|ys().size() < 3"))?.detail).toBe("map → list");
    expect(hover(rule("exis|ts(path('teams/t1'))"))?.detail).toBe("path → bool");
    expect(hover(rule("reque|st.auth != null"))?.detail).toBe("the request");
    expect(hover(rule("request.auth.uid == u|id"))?.detail).toBe("path capture");
    expect(hover(rule("request.auth.uid == u|id"))?.info).toContain("users/{uid}");
  });

  it("has nothing for unknown words", () => {
    expect(hover(rule("foo|bar == 1"))).toBeUndefined();
  });
});
