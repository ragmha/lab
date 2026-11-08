# Contributing to invoicer

Thanks for helping. invoicer is small, but it moves money, so we are strict
about a few things. Please read this guide before opening a pull request.

## Ground rules

- Be kind and assume good intent. See the code of conduct at the end.
- Open an issue before large changes so we can agree on the approach.
- Keep pull requests focused: one logical change per pull request.
- Never commit customer data. Invoices in tests must be synthetic.

## Development setup

invoicer needs Python 3.11 or newer and has no runtime dependencies.

    python -m venv .venv
    . .venv/bin/activate
    python -m pip install pytest

## Running the tests

    python -m pytest

The suite runs in well under a second and must pass before you push.

`tests/data/samples.json` holds golden invoices. Their expected totals were
checked by hand by the finance team. If a sample disagrees with the code,
assume the code is wrong. Never regenerate the samples from the code.

## Money and rounding rules

- Use `decimal.Decimal` for every amount. `to_decimal` rejects floats.
- Round each line amount (quantity times unit price) to the currency first.
- Coupons apply before tax. A coupon is split across lines in proportion to
  their amounts, so each line is taxed on what the customer actually pays.
- Round tax once for the whole invoice, not per line.
- Round half up (away from zero) to the currency's minor unit.

## Tax regions

Rates in `invoicer/rates.py` are illustrative and are not tax advice.

- Exclusive regions (US sales tax, Canadian GST/HST) add tax on top of the
  price.
- Inclusive regions (VAT and GST elsewhere) quote prices with tax included.
  The invoice shows the tax contained in the price.
- To add a region, add one `_region(...)` line in the right block and a test.

## Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org/). The
changelog is generated from commit subjects, so the format matters.

    <type>(<scope>): <summary>

Types:

- `feat`: a new feature
- `fix`: a bug fix
- `docs`: documentation only
- `test`: adding or fixing tests
- `refactor`: a change that neither fixes a bug nor adds a feature
- `perf`: a performance improvement
- `chore`: tooling, releases and housekeeping

Scopes: `money`, `tax`, `discounts`, `invoice`, `format`, `cli`, `samples`
and `release`. The scope is required for `feat`, `fix`, `refactor` and
`perf`.

Summary rules:

- imperative mood ("apply", not "applied" or "applies")
- lowercase first letter and no trailing period
- the whole subject line is at most 72 characters

Use the body to explain why the change is needed, wrapped at 72 columns.
Reference issues in the footer, for example `Fixes #123`.

Examples:

    fix(money): round half away from zero for negative amounts
    feat(cli): add a csv format to the render command
    docs: explain inclusive and exclusive tax regions

## Pull requests

- Rebase on `main` before asking for review. We do not merge `main` into
  feature branches.
- Fill in the pull request template, including how you tested the change.
- One approving review from a maintainer is required. Finance must also
  approve changes to rates, rounding or samples.
- CI runs the test suite on Python 3.11, 3.12 and 3.13.

## Releases

Maintainers cut releases from `main`:

1. Update the version in `pyproject.toml` and `invoicer/__init__.py`.
2. Move the release's entries into a new section of `CHANGELOG.md`.
3. Commit with `chore(release): <version>` and tag `v<version>`.
4. Push the tag. CI publishes the package.

## Code of conduct

We follow the Contributor Covenant. Report unacceptable behaviour to the
maintainers privately. We respond within two working days.
