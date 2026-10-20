# Token-diet experiment

This kit compares six Copilot CLI setups on the same seeded bug-fix task:

| Setup | What changes |
| --- | --- |
| `a` | Baseline |
| `b` | Six simple instructions in the user instructions file |
| `c` | caveman |
| `d` | rtk |
| `e` | caveman, rtk, and the six instructions |
| `f` | Token Optimizer |

Each setup runs five times in a fresh repository copy and home directory. The
runner verifies the committed changes against the original tests and an
additional hidden test. Raw logs stay under the ignored `.work/` directory;
the summarizer redacts paths and writes the publishable measurements to
`src/data/token-diet.json`.

## Requirements

- macOS or Linux, with Bash, Git, Node.js, npm/npx, and Bun
- GitHub Copilot CLI, authenticated with `COPILOT_GITHUB_TOKEN`, `GH_TOKEN`, or
  `gh auth login`
- `uv` and Python 3.12
- rtk 1.0.1 executable at `scripts/token-diet/.work/tools/rtk`
- Network access for npx to install the pinned caveman revision
- Network access to clone Token Optimizer v5.13.48 at commit
  `a8d77d2275fde689d0d69e644f80c057de4e7238`

The script honors `COPILOT`, `NODE_BIN`, `MODEL`, `EFFORT`, `CREDITS`, and
`TIMEOUT` environment overrides. Defaults match the recorded experiment; change
them only when intentionally producing a different dataset.

## Run

From the repository root:

```sh
export CREDITS=100

mkdir -p scripts/token-diet/.work/tools
cp /path/to/rtk scripts/token-diet/.work/tools/rtk
chmod +x scripts/token-diet/.work/tools/rtk

./scripts/token-diet/run.sh setup
./scripts/token-diet/run.sh selfcheck
./scripts/token-diet/run.sh run 1
./scripts/token-diet/run.sh run 2
./scripts/token-diet/run.sh run 3
./scripts/token-diet/run.sh run 4
./scripts/token-diet/run.sh run 5
bun scripts/token-diet/summarize.ts
```

`setup` creates the fixture and isolated configuration homes. The Token
Optimizer adapter is installed only into the isolated `f` home; it does not
touch the user's Copilot configuration. Its noncommercial license permits
personal research and testing; see the [license](https://github.com/alexgreensh/token-optimizer/blob/v5.13.48/LICENSE).
`selfcheck` proves the verifier catches each seeded bug and rejects invalid
commit subjects. Each `run <round>` launches all six setups concurrently. The
summarizer requires all 30 runs before writing the canonical Round 1 dataset,
so a missing Token Optimizer setup cannot replace the published comparison.
Round 2 and non-default model summaries require five runs of every original
setup (a-e), plus all five Token Optimizer runs whenever setup f is present.
Every summary checks token totals, usage charges, and redaction before writing
the JSON file.

The public page is `https://lab.raghib.io/token-diet/`. Round 1 and the regression-hunt
Round 2 have separate views, each with its own call waterfall, measurements,
task prompt, method, and conclusions. The published JSON contains aggregate
call metrics and short redacted tool labels, not raw Copilot event logs, source
paths, or credentials.

The experiment measures one task, one model, and five runs per setup. It is a
small demonstration, not a general benchmark; rerun it on representative tasks
before drawing broader conclusions.

## Round 2: regression hunt

Round 1 gave the tools little to compress. The agent filtered pytest output
itself, sessions were short, and replies were terse. Round 2 is deliberately
designed to favour rtk and caveman: it produces verbose output the agent is
unlikely to pre-filter, needs a longer investigation, and asks for a prose
reply. Read its results with that in mind.

The bugs (`bugs.tsv`), hidden test, verifier, and setup homes are the same as in
round 1. `history2.py` deterministically builds a different repository:

- The round-1 history with all three bugs fixed, tagged `v0.9.0`.
- After the tag, 38 commits by four authors from April to June 2024. They add
  local sales tax data, CLI options, formatting, tests, and docs.
- Three of those commits each reintroduce one bug inside a larger change.

At `HEAD`, 89 of 1,119 tests fail, plain `pytest` prints about 100 KB, and
`git diff v0.9.0` is about 5,300 lines. The prompt asks the agent to:

1. Find the commit that introduced each problem.
2. Fix and commit.
3. Reply with an incident note for finance.

```sh
ROUND=2 ./scripts/token-diet/run.sh setup
ROUND=2 ./scripts/token-diet/run.sh selfcheck
ROUND=2 ./scripts/token-diet/run.sh run 1   # through 5
ROUND=2 bun scripts/token-diet/summarize.ts   # writes src/data/token-diet-2.json
```

Round 2 writes only under `.work/r2/`: `fixture-repo`, `base.sha`,
`versions.txt`, and `runs/`. It reuses round 1's `.work/venv`, `.work/tools`,
and `.work/homes`. Its `setup` builds homes only if `.work/homes` is missing.
