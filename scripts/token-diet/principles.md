# Working principles

- Be brief. No preamble, no recap of what you did.
- Search before you read: find the relevant code with grep or glob, then view only the lines you need.
- Never re-read a file you have not changed.
- Keep command output small: run `python -m pytest -q --tb=short`, and pipe long output through `tail -n 40` or `grep`.
- Make independent tool calls in parallel.
- Stop as soon as the task is done and verified.
