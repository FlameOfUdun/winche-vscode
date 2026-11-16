import * as path from "path";
import * as vscode from "vscode";
import { LanguageClient, LanguageClientOptions, ServerOptions, State } from "vscode-languageclient/node";
import { analyze, definedFunctions, describe, FieldInfo, OPERATIONS, RuleSubsystem, suggest, Suggestion } from "./rulesCompletion";
import { analyzeTest, matchPatterns, suggestTest, TestSuggestion } from "./testCompletion";

const RULES = "winche-rules";
const GUIDE = "https://github.com/FlameOfUdun/winche-rules/blob/main/GUIDE.md";
const TESTS = "winche-rules-test";

let client: LanguageClient | undefined;
let warned = false;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(RULES, { provideCompletionItems: rulesCompletions }, ".", " ", "("),
    vscode.languages.registerCompletionItemProvider(TESTS, { provideCompletionItems: testCompletions }, " ", "/"),
    vscode.languages.registerHoverProvider(RULES, { provideHover: rulesHover }),
    vscode.languages.registerHoverProvider(TESTS, { provideHover: testHover }),
    vscode.commands.registerCommand("winche.rules.test", () => runInTerminal("rules test")),
    vscode.commands.registerCommand("winche.rules.validate", () => runInTerminal("rules validate")),
    vscode.commands.registerCommand("winche.openGuide", () => vscode.env.openExternal(vscode.Uri.parse(GUIDE))),
    vscode.commands.registerCommand("winche.restartServer", async () => { await stopServer(); await startServer(context); }),
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (e.affectsConfiguration("winche.cli")) { await stopServer(); await startServer(context); }
    }),
  );
  await startServer(context);
}

export async function deactivate(): Promise<void> {
  await stopServer();
}

// ----- the language server (winche lsp) ---------------------------------------------------------

function cli(): { command: string; args: string[] } {
  const config = vscode.workspace.getConfiguration("winche.cli");
  return { command: config.get<string>("path") || "winche", args: config.get<string[]>("args") ?? [] };
}

async function startServer(context: vscode.ExtensionContext): Promise<void> {
  const { command, args } = cli();
  const serverOptions: ServerOptions = { command, args: [...args, "lsp"] };
  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ language: RULES }, { language: TESTS }],
    initializationFailedHandler: () => false,
  };
  client = new LanguageClient("winche", "Winche", serverOptions, clientOptions);
  try {
    await client.start();
  } catch {
    client = undefined;
    if (!warned) {
      warned = true;
      const install = "Copy install command";
      const choice = await vscode.window.showWarningMessage(
        `Winche: couldn't start '${command} lsp', so errors, test results and formatting are off (colours and suggestions still work). Install the CLI with: dotnet tool install -g Winche.Cli`,
        install, "Settings");
      if (choice === install) await vscode.env.clipboard.writeText("dotnet tool install -g Winche.Cli");
      if (choice === "Settings") await vscode.commands.executeCommand("workbench.action.openSettings", "winche.cli");
    }
  }
  void context;
}

async function stopServer(): Promise<void> {
  const c = client;
  client = undefined;
  if (c && c.state === State.Running) await c.stop();
}

function runInTerminal(subcommand: string): void {
  const editor = vscode.window.activeTextEditor;
  const folder = editor ? path.dirname(editor.document.uri.fsPath) : vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const { command, args } = cli();
  const terminal = vscode.window.createTerminal({ name: "Winche", cwd: folder });
  terminal.show();
  terminal.sendText([command, ...args].map(quote).join(" ") + " " + subcommand);
}

function quote(s: string): string {
  return /^[\w./:-]+$/.test(s) ? s : `"${s.replace(/"/g, '\\"')}"`;
}

// ----- .rules completion and hover --------------------------------------------------------------

const KIND: Record<Suggestion["type"], vscode.CompletionItemKind> = {
  keyword: vscode.CompletionItemKind.Keyword,
  variable: vscode.CompletionItemKind.Variable,
  property: vscode.CompletionItemKind.Field,
  method: vscode.CompletionItemKind.Method,
  function: vscode.CompletionItemKind.Function,
  type: vscode.CompletionItemKind.TypeParameter,
};

function subsystemOf(document: vscode.TextDocument): RuleSubsystem {
  return path.basename(document.uri.fsPath).toLowerCase().startsWith("storage") ? "storage" : "database";
}

async function fields(document: vscode.TextDocument, subsystem: RuleSubsystem, pattern: string | undefined): Promise<FieldInfo[]> {
  if (!client || client.state !== State.Running || (subsystem === "database" && !pattern)) return [];
  try {
    const result = await Promise.race([
      client.sendRequest<{ fields: FieldInfo[] }>("winche/fields", { uri: document.uri.toString(), subsystem, pattern: pattern ?? "" }),
      new Promise<{ fields: FieldInfo[] }>((resolve) => setTimeout(() => resolve({ fields: [] }), 1500)),
    ]);
    return result.fields ?? [];
  } catch {
    return [];
  }
}

async function rulesCompletions(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.CompletionItem[]> {
  const text = document.getText();
  const ctx = analyze(text, document.offsetAt(position));
  const subsystem = subsystemOf(document);
  const needsFields = ctx.where === "condition" && ctx.receiver !== null && /^(request\.resource|resource)\b/.test(ctx.receiver);
  const docFields = needsFields ? await fields(document, subsystem, ctx.patterns[ctx.patterns.length - 1]) : [];
  const range = new vscode.Range(document.positionAt(ctx.from), position);
  return suggest(ctx, docFields, subsystem, definedFunctions(text)).map((s, i) => {
    const item = new vscode.CompletionItem(s.label, KIND[s.type]);
    item.range = range;
    item.detail = s.detail;
    if (s.info) item.documentation = new vscode.MarkdownString(s.info);
    item.sortText = String(i).padStart(4, "0");
    const insert = s.insert ?? s.label;
    // "()" / "('')" / "([])" / "has only []": put the cursor inside.
    const inside = insert.match(/^(.*\()(''|\[\]|)(\)|, null\))$/);
    if (inside) item.insertText = new vscode.SnippetString(`${escape(inside[1])}${inside[2] === "''" ? "'$0'" : inside[2] === "[]" ? "[$0]" : "$0"}${escape(inside[3])}`);
    else if (insert.endsWith("[]")) item.insertText = new vscode.SnippetString(`${escape(insert.slice(0, -2))}[$0]`);
    else item.insertText = insert;
    if (s.label.includes(" ")) item.filterText = s.label;
    return item;
  });
}

function escape(s: string): string {
  return s.replace(/[$}\\]/g, "\\$&");
}

const KEYWORDS: Record<string, string> = {
  match: "`match <path> { … }` — the rules for the documents at a path. `{name}` captures one segment, `{name=**}` the rest. A nested match extends its parent's path.",
  allow: "`allow <operations>: if <condition>;` — grants the operations when the condition holds. Rules only grant: nothing is allowed unless some rule allows it.",
  if: "The condition after `allow …:`. `allow read;` with no condition allows unconditionally.",
  function: "`function name(params) { let x = …; return …; }` — a named condition. Visible in the block it's in (and nested ones), or everywhere at the top level; call it before or after it's defined.",
  let: "`let name = value;` — a name for a value inside a function, usable in the lines after it.",
  return: "`return condition;` — what a function gives; its last line.",
  in: "`x in list` — the list contains x; `key in map` — the map has that key",
  is: "Type check: `x is string` (string integer double number boolean null map array timestamp bytes documentReference fileReference userReference geoPoint)",
  not: "`x not in list` — the same as `!(x in list)`",
  has: "`map has only [...]` / `has all [...]` / `has any [...]` — about the map's keys: a document's fields, a token's claims. Shorthand for `map.keys().hasOnly([...])` (`hasAll`, `hasAny`).",
  changes: "`changes only [...]` / `changes all [...]` / `changes any [...]` — the fields an update changes. Shorthand for `request.resource.data.diff(resource.data).affectedKeys().hasOnly([...])` (`hasAll`, `hasAny`).",
};

function rulesHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
  const range = document.getWordRangeAtPosition(position, /[A-Za-z_]\w*/);
  if (!range) return undefined;
  const word = document.getText(range);
  const text = document.getText();
  const offset = document.offsetAt(position);
  const ctx = analyze(text, offset);
  const line = document.lineAt(position.line).text;
  const operatorWord = (w: string) => w === "not" ? /^\s+in\b/.test(line.slice(range.end.character))
    : w === "has" || w === "changes" ? /^\s+(only|all|any)\b/.test(line.slice(range.end.character)) : true;
  if (KEYWORDS[word] && operatorWord(word)) return new vscode.Hover(new vscode.MarkdownString(KEYWORDS[word]), range);
  const pair = /\b(has|changes)\s+$/.exec(line.slice(0, range.start.character));
  if (pair && (word === "only" || word === "all" || word === "any")) return new vscode.Hover(new vscode.MarkdownString(KEYWORDS[pair[1]]), range);
  if (ctx.where === "operations" || ctx.where === "beforeIf") {
    const op = OPERATIONS.find((o) => o.label === word);
    if (op) return new vscode.Hover(new vscode.MarkdownString(`**${op.label}** — ${op.detail}`), range);
  }
  // A function this file defines: show its definition.
  const own = definedFunctions(text).find((f) => f.name === word);
  if (own && /^\s*\(/.test(line.slice(range.end.character))) {
    const def = new RegExp(`\\bfunction\\s+${word}\\s*\\([^)]*\\)\\s*\\{[\\s\\S]*?\\breturn\\b[\\s\\S]*?;\\s*\\}`).exec(text);
    const md = new vscode.MarkdownString();
    md.appendCodeblock(def ? def[0] : `function ${own.name}(${own.params.join(", ")})`, "winche-rules");
    md.appendMarkdown("*A function defined in this file*");
    return new vscode.Hover(md, range);
  }
  const s = describe(text, offset, subsystemOf(document));
  if (!s) return undefined;
  const md = new vscode.MarkdownString();
  md.appendCodeblock(s.insert ?? s.label, "winche-rules");
  if (s.detail) md.appendMarkdown(`*${s.detail}*`);
  if (s.info) md.appendMarkdown(`\n\n${s.info}`);
  md.appendMarkdown(`\n\n[Rules Language Guide](${GUIDE})`);
  return new vscode.Hover(md, range);
}

const TEST_KEYWORDS: Record<string, string> = {
  test: "`test \"name\" { … }` — a named group of checks. Setup lines apply to the checks after them.",
  documents: "`documents { path: { … } }` — what `get()` and `exists()` see. At the top of the file for every test; in a test, added to them.",
  auth: "`auth { uid: 'u1', role: 'staff' }` — the caller's claims: `request.auth.uid` plus every claim under `request.auth.token`. Omit, or `auth none`, for a signed-out caller.",
  resource: "`resource { … }` — the existing document (`resource`) for the checks that follow.",
  time: "`time timestamp('…')` — `request.time` for the checks that follow (default: now).",
  allow: "`allow <op> <path>` — passes when the rules allow it.",
  deny: "`deny <op> <path>` — passes when the rules deny it.",
  with: "`with { … }` — the incoming document (`request.resource`) of a create or update.",
  where: "`where field == value && …` — a list query's filters; the rules must prove every result is allowed (rules are not filters).",
  group: "`list group <id>` — a collection group query: every collection with that id, under any parent.",
  none: "`auth none` — a signed-out caller (`request.auth == null`).",
  get: "**get** — read one document", list: "**list** — query a collection", create: "**create** — write a new document",
  update: "**update** — change a document", delete: "**delete** — remove a document",
  timestamp: "`timestamp('2026-01-01T00:00:00Z')` — a timestamp value", path: "`path('users/u1')` — a documentReference", bytes: "`bytes('base64')` — a bytes value",
  fileReference: "`fileReference('scans/a.png')` — a file, by its path", userReference: "`userReference('u1')` — a user, by uid",
  geoPoint: "`geoPoint(51.5, -0.12)` — a latitude (-90 to 90) and longitude (-180 to 180)",
};

function testHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
  const range = document.getWordRangeAtPosition(position, /[A-Za-z_]\w*/);
  if (!range) return undefined;
  const line = document.lineAt(position.line).text;
  const before = line.slice(0, range.start.character);
  if (/['"][^'"]*$/.test(before) || before.includes("//")) return undefined;   // inside a string or comment
  // Only keywords in keyword position: not path segments (users/get) or map keys (get: …).
  if (/\/$/.test(before) || /^\s*:/.test(line.slice(range.end.character))) return undefined;
  const doc = TEST_KEYWORDS[document.getText(range)];
  return doc ? new vscode.Hover(new vscode.MarkdownString(doc), range) : undefined;
}

// ----- .rules.test completion -----------------------------------------------------------------

const TEST_KIND: Record<TestSuggestion["kind"], vscode.CompletionItemKind> = {
  keyword: vscode.CompletionItemKind.Keyword,
  operation: vscode.CompletionItemKind.EnumMember,
  path: vscode.CompletionItemKind.File,
  snippet: vscode.CompletionItemKind.Snippet,
  function: vscode.CompletionItemKind.Function,
};

/** The rules file a test file tests: X.rules next to X.rules.test (open copy first). */
async function pairedRules(document: vscode.TextDocument): Promise<string> {
  const rulesPath = document.uri.fsPath.replace(/\.test$/, "");
  const open = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === rulesPath);
  if (open) return open.getText();
  try {
    return Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.file(rulesPath))).toString("utf8");
  } catch {
    return "";
  }
}

async function testCompletions(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.CompletionItem[]> {
  const ctx = analyzeTest(document.getText(), document.offsetAt(position));
  const patterns = ctx.where === "afterOperation" ? matchPatterns(await pairedRules(document)) : [];
  const range = new vscode.Range(document.positionAt(ctx.from), position);
  return suggestTest(ctx, patterns).map((s, i) => {
    const item = new vscode.CompletionItem(s.label, TEST_KIND[s.kind]);
    item.range = range;
    item.detail = s.detail;
    if (s.info) item.documentation = new vscode.MarkdownString(s.info);
    item.insertText = s.snippet ? new vscode.SnippetString(s.snippet) : s.label;
    item.sortText = String(i).padStart(4, "0");
    if (s.snippet?.endsWith(" ")) item.command = { command: "editor.action.triggerSuggest", title: "" };
    return item;
  });
}
