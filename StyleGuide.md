# Style Guide

Language-agnostic conventions drawn from common industry practice. Where a language has an official or dominant style guide, that guide wins for language-specific details (see [References](#references)).

## 1. General Principles

- **Readability first.** Code is read far more often than it is written.
- **Be consistent.** Match the surrounding code over personal preference.
- **Keep it simple.** Prefer the obvious solution (KISS); don't build for hypothetical needs (YAGNI).
- **Don't repeat yourself**, but don't abstract until a pattern has appeared about three times.
- **Automate style.** Use a formatter and linter, not code review, to enforce formatting.

## 2. Formatting

- Use UTF-8 and LF line endings.
- End every file with a single newline; no trailing whitespace.
- Keep lines to 100 characters or fewer (80 for prose and comments where practical).
- Indentation: follow the language's convention (2 spaces for JS/TS/YAML/JSON, 4 for Python, tabs for Go). Never mix tabs and spaces.
- Add an `.editorconfig` so editors agree.

## 3. Naming

| Kind                        | Convention                                      |
| --------------------------- | ----------------------------------------------- |
| Variables, functions        | Language norm (`camelCase` or `snake_case`)     |
| Classes, types              | `PascalCase`                                    |
| Constants                   | `UPPER_SNAKE_CASE`                              |
| Files and directories       | `kebab-case` or language norm; be consistent    |
| Booleans                    | Read as a question: `isReady`, `hasAccess`      |

- Use descriptive names; avoid abbreviations except universal ones (`id`, `url`, `http`).
- Functions are verbs (`fetchUser`), values and types are nouns.
- No single-letter names outside tiny scopes such as loop indices.

## 4. Code Structure

- Functions do one thing; aim for under ~40 lines.
- Limit parameters (3 or fewer is a good target); group related ones into an object.
- Prefer early returns over deep nesting.
- Avoid magic numbers and strings; name them as constants.
- Keep modules small and cohesive. No circular dependencies.

## 5. Comments and Documentation

- Comment **why**, not what. Well-named code explains the what.
- Delete dead code instead of commenting it out; version control remembers it.
- Mark unfinished work as `TODO(name): description` and link an issue when possible.
- Public functions and modules get doc comments in the language's standard format.
- Keep the README and docs updated in the same change as the code.

## 6. Error Handling

- Fail fast and loudly; never swallow errors silently.
- Handle errors at the layer that can do something useful about them.
- Error messages should say what happened and how to fix it, without leaking secrets.
- Validate input at system boundaries.

## 7. Testing

- New behavior and bug fixes come with tests.
- Tests are deterministic, independent, and fast.
- Name tests after the behavior they verify.
- Follow Arrange / Act / Assert.

## 8. Security

- Never commit secrets, tokens, or credentials. Use environment variables or a secrets manager (see [The Twelve-Factor App](https://12factor.net/config)).
- Keep `.env` files in `.gitignore`; commit a `.env.example` instead.
- Treat all external input as untrusted.
- Keep dependencies current and pinned via a lockfile.

## 9. Git Workflow

### Branches

- `main` is always releasable; no direct pushes.
- Branch names: `type/short-description`, e.g. `feat/login-page`, `fix/null-crash`.

### Commits

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<optional scope>): <short summary>

<optional body explaining why>
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`.

- Summary in the imperative mood ("add", not "added"), 72 characters or fewer, no trailing period.
- One logical change per commit.

### Pull Requests

- Small and focused; describe what changed and why.
- Link the related issue.
- All checks pass and at least one review before merge.

### Versioning

Use [Semantic Versioning](https://semver.org/) (`MAJOR.MINOR.PATCH`) and keep a changelog in the [Keep a Changelog](https://keepachangelog.com/) format.

## 10. Code Review

- Review the code, not the person. Be specific and kind.
- Distinguish blocking issues from suggestions (prefix with `nit:` for minor ones).
- Authors respond to every comment; reviewers respond promptly.

## References

- [Google Style Guides](https://google.github.io/styleguide/)
- [Conventional Commits](https://www.conventionalcommits.org/)
- [Semantic Versioning](https://semver.org/)
- [Keep a Changelog](https://keepachangelog.com/)
- [The Twelve-Factor App](https://12factor.net/)
- [EditorConfig](https://editorconfig.org/)
- [PEP 8](https://peps.python.org/pep-0008/) (Python)
- [Airbnb JavaScript Style Guide](https://github.com/airbnb/javascript)
