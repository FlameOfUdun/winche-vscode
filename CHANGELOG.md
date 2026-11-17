# Changelog

## 0.2.0

- Functions: when a `winche.json` names a functions folder, offers to install the Deno extension and to turn Deno on
  for that folder only (`deno.enablePaths`), so `@winche/functions` resolves and the rest of the repository keeps its
  own TypeScript setup. Command **Winche: Set up functions in this editor**; setting `winche.functions.setUpDeno`.
- Named "Winche" (it's no longer only the rules); an icon.
- Rules: the full value type names of Winche.Rules 5.0 (`boolean`, `integer`, `documentReference`, …); `assets.rules`
  is a rules file like the others. Needs Winche CLI 2.0.0 or later.

## 0.1.0

- Functions (`function`, `let`, `return`) and built paths (`/users/$(request.auth.uid)`) from Winche.Rules 4.1.0:
  colours, suggestions for the file's own functions, and hover showing a function's definition.

- The readable forms of Winche.Rules 4.1.0 (`not in`, `has only|all|any`, `changes only|all|any`): colours,
  suggestions and hover.

- `.rules` and `.rules.test` languages: syntax colours, suggestions, hover docs.
- With Winche CLI 1.1.0+ (`winche lsp`): errors as you type, live rule tests with per-test results, formatting,
  and document field names from the console.
