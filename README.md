# Winche for VS Code

Edit [Winche](https://github.com/FlameOfUdun) access rules with the help you'd expect: colours, suggestions,
errors as you type, formatting, and rule tests that run while you edit.

- **`.rules` files** (`database.rules`, `storage.rules`): syntax colours; suggestions for keywords, operations,
  the word operators (`in`, `not in`, `is`, `has only`, `changes only`, …),
  path captures in scope, `request.` / `resource.` members, functions and methods (with a short description),
  and — when you're signed in with `winche login` — the **field names of your documents**, sampled by the
  console for the enclosing `match`; hover docs; errors and unknown-function warnings as you type; Format
  Document (a file with `//` comments is left as it is, since rules are stored without them).
- **`.rules.test` files** (`database.rules.test`): colours; suggestions for `test`, `allow` / `deny`,
  operations, setup lines and **paths taken from the rules file's `match` patterns** (from `X.rules` next to
  `X.rules.test`); hover docs; the tests **run as you type** (in either file), with failing checks underlined and
  each test's result shown above it.

```text
test "owners read their profile" {
  auth { uid: 'u1' }
  allow get users/u1          // ✓
  deny get users/u2           // ✓
}
```

- **Functions**: Winche functions are TypeScript run by Deno, and `@winche/functions` resolves through the functions
  folder's `deno.json`, which only the [Deno extension](https://marketplace.visualstudio.com/items?itemName=denoland.vscode-deno)
  reads. When a `winche.json` names a functions folder, this extension offers to install the Deno extension and to
  turn Deno on for **that folder only** (`deno.enablePaths` in the workspace settings), so the rest of the
  repository keeps its own TypeScript setup. Turn the offer off with `winche.functions.setUpDeno`; run it again with
  **Winche: Set up functions in this editor**.

New to the rules language? Read the **[Rules Language Guide](https://github.com/FlameOfUdun/winche-rules/blob/main/GUIDE.md)**.

## Requirements

Colours, suggestions and hover work on their own. Errors, test results, formatting and document field names
come from the Winche CLI's language server:

```sh
dotnet tool install -g Winche.Cli     # 2.0.0 or later
```

If `winche` isn't on your `PATH`, set **`winche.cli.path`** (and `winche.cli.args`, e.g. `dotnet` +
`["path/to/winche.dll"]`).

## Commands

- **Winche: Run Rule Tests** — `winche rules test` in a terminal, in the open file's folder
- **Winche: Validate Rules** — `winche rules validate`, the same way
- **Winche: Restart Language Server**
- **Winche: Open Rules Language Guide** — the guide in your browser
- **Winche: Set up functions in this editor** — the Deno extension, and Deno on for the functions folder

Tests pair with rules files through `winche.json` (`"tests": { "database": "database.rules.test" }`), or by
name: `X.rules.test` tests `X.rules`. See the [CLI](https://github.com/FlameOfUdun/winche-cli) for the test
syntax, `winche login` and deploying rules.

## Develop

```sh
npm install
npm test          # completion logic (vitest)
npm run build     # dist/extension.js
npm run package   # winche-<version>.vsix  →  code --install-extension winche-<version>.vsix
```

Press F5 in VS Code with this folder open to try it in an Extension Development Host.

**Releases:** push a `v*` tag matching `version` in package.json. GitHub Actions tests, packages one `.vsix`, and
publishes it with **trusted publishing** (this workflow's OIDC token, no stored secrets) to:

- the **VS Code Marketplace**: publisher `FlameOfUdun`, with a trusted-publishing policy for this repository and
  `.github/workflows/publish.yml` (Marketplace → Manage publisher);
- **Open VSX** (Cursor, VSCodium, …): namespace `FlameOfUdun`, with this repository and workflow added as a trusted
  publisher on open-vsx.org.

## License

See [LICENSE](LICENSE).
