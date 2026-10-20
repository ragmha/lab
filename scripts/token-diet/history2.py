"""Build the round-2 invoicer repository: release 0.9.0, then three months of work.

    .work/venv/bin/python history2.py <empty-dir>

The first ten commits match round 1 with every fix in bugs.tsv applied, tagged
v0.9.0. Thirty-eight later commits by four authors follow; three of them put
one bugs.tsv bug back each, inside a larger change. Authors, dates and content
are fixed, so every run produces the same SHAs.
"""

from __future__ import annotations

import csv
import hashlib
import io
import json
import os
import re
import subprocess
import sys
import textwrap
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

KIT = Path(__file__).resolve().parent
FIXTURE = KIT / "fixture"
BUGS = [line.split("\t") for line in (KIT / "bugs.tsv").read_text(encoding="utf-8").splitlines() if line]
SCOPES = "(money|tax|discounts|invoice|format|cli|samples|release)"
SUBJECT = re.compile(rf"^((feat|fix|refactor|perf)\({SCOPES}\)|(docs|test|chore)(\({SCOPES}\))?): [a-z].*[^.]$")
RELEASE = re.compile(r"^chore\(release\): \d+\.\d+\.\d+$")  # CONTRIBUTING.md's release subject


def valid_subject(subject: str) -> bool:
    return bool(RELEASE.match(subject)) or (len(subject) <= 72 and bool(SUBJECT.match(subject)))


AUTHORS = {
    "sam": ("Sam Rivera", "sam@example.com"),
    "priya": ("Priya Natarajan", "priya@example.com"),
    "tomas": ("Tomás Ortega", "tomas@example.com"),
    "amara": ("Amara Okafor", "amara@example.com"),
}


def h(*parts: object) -> int:
    """Stable pseudo-random integer for ``parts`` (no dependence on Python's RNG)."""
    return int.from_bytes(hashlib.sha256("|".join(map(str, parts)).encode()).digest()[:8], "big")


def money(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def pct(rate: Decimal) -> str:
    return f"{(Decimal(rate) * 100).quantize(Decimal('0.001'), rounding=ROUND_HALF_UP)}%"


def wrap(text: str) -> str:
    paragraphs = [" ".join(p.split()) for p in text.strip().split("\n\n")]
    return "\n\n".join(textwrap.fill(p, 72, break_on_hyphens=False) for p in paragraphs)


class Repo:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.files: dict[str, str] = {}
        self.later = 0

    def git(self, *args: str, env: dict[str, str] | None = None) -> str:
        full = {**os.environ, "GIT_CONFIG_GLOBAL": "/dev/null", "GIT_CONFIG_NOSYSTEM": "1", **(env or {})}
        done = subprocess.run(["git", "-C", str(self.path), *args], capture_output=True, text=True, env=full)
        if done.returncode:
            raise SystemExit(f"history2: git {' '.join(args)} failed:\n{done.stderr}")
        return done.stdout

    def python(self, *args: str, stdin: str | None = None) -> str:
        env = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1"}
        done = subprocess.run([sys.executable, *args], cwd=self.path, input=stdin, capture_output=True, text=True, env=env)
        if done.returncode:
            raise SystemExit(f"history2: python {' '.join(args[:1])} failed:\n{done.stderr}")
        return done.stdout

    def write(self, rel: str, text: str) -> None:
        self.files[rel] = text
        target = self.path / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding="utf-8")

    def sub(self, rel: str, old: str, new: str) -> None:
        text = self.files[rel]
        if text.count(old) != 1:
            raise SystemExit(f"history2: {rel}: expected one {old!r}, found {text.count(old)}")
        self.write(rel, text.replace(old, new))

    def resub(self, rel: str, pattern: str, repl: str, count: int) -> None:
        text, n = re.subn(pattern, repl, self.files[rel])
        if n != count:
            raise SystemExit(f"history2: {rel}: expected {count} matches for {pattern!r}, found {n}")
        self.write(rel, text)

    def after(self, rel: str, anchor: str, text: str) -> None:
        self.sub(rel, anchor, anchor + text)

    def append(self, rel: str, text: str) -> None:
        self.write(rel, self.files[rel] + text)

    def commit(self, who: str, date: str, subject: str, body: str = "") -> None:
        if not valid_subject(subject):
            raise SystemExit(f"history2: bad subject: {subject}")
        name, email = AUTHORS[who]
        env = {
            "GIT_AUTHOR_NAME": name,
            "GIT_AUTHOR_EMAIL": email,
            "GIT_AUTHOR_DATE": date,
            "GIT_COMMITTER_NAME": name,
            "GIT_COMMITTER_EMAIL": email,
            "GIT_COMMITTER_DATE": date,
        }
        self.git("add", "-A")
        self.git("commit", "-q", "-m", subject + (f"\n\n{wrap(body)}\n" if body else ""), env=env)


# --- Local sales tax data: one combined rate per three-digit ZIP prefix -------
ZIP3 = {
    "US-CA": "900-961", "US-NV": "889-898", "US-AZ": "850-865", "US-NM": "870-884",
    "US-UT": "840-847", "US-CO": "800-816", "US-WA": "980-994", "US-ID": "832-838",
    "US-WY": "820-831", "US-HI": "967-968",
    "US-OH": "430-459", "US-IL": "600-629", "US-WI": "530-549", "US-MN": "550-567",
    "US-IA": "500-528", "US-MO": "630-658", "US-KS": "660-679", "US-NE": "680-693",
    "US-SD": "570-577", "US-ND": "580-588",
    "US-TX": "750-799 885", "US-OK": "730-749", "US-AR": "716-729", "US-LA": "700-714",
    "US-MS": "386-397", "US-AL": "350-369", "US-TN": "370-385", "US-GA": "300-319 398-399",
    "US-FL": "320-349", "US-SC": "290-299", "US-NC": "270-289", "US-VA": "201 220-246",
    "US-WV": "247-268",
    "US-NY": "005 100-149", "US-PA": "150-196", "US-VT": "050-054 056-059",
}  # fmt: skip
GAPS = set(
    "213 269 343 345 348 353 419 428 429 517 518 519 529 533 536 552 568 578 579 589 621 632 642 643 659 663 "
    "682 715 732 742 771 839 848 849 851 854 858 861 862 866 867 868 869 872 876 886 887 888 892 896 909 929 "
    "969 986 993".split()
)
MAX_LOCAL = {
    "US-CA": "0.03", "US-NV": "0.015", "US-AZ": "0.03", "US-NM": "0.0375", "US-UT": "0.0275", "US-CO": "0.05",
    "US-WA": "0.04", "US-ID": "0.03", "US-WY": "0.02", "US-HI": "0.005",
    "US-OH": "0.0225", "US-IL": "0.045", "US-WI": "0.0175", "US-MN": "0.02", "US-IA": "0.02", "US-MO": "0.0575",
    "US-KS": "0.04", "US-NE": "0.0225", "US-SD": "0.03", "US-ND": "0.035",
    "US-TX": "0.02", "US-OK": "0.07", "US-AR": "0.0525", "US-LA": "0.07", "US-MS": "0.01", "US-AL": "0.075",
    "US-TN": "0.0275", "US-GA": "0.04", "US-FL": "0.02", "US-SC": "0.03", "US-NC": "0.0275", "US-VA": "0.0175",
    "US-WV": "0.01",
    "US-NY": "0.05", "US-PA": "0.02", "US-VT": "0.01",
}  # fmt: skip
GROUPS = {
    "west": ["US-AZ", "US-CA", "US-CO", "US-HI", "US-ID", "US-NM", "US-NV", "US-UT", "US-WA", "US-WY"],
    "midwest": ["US-IA", "US-IL", "US-KS", "US-MN", "US-MO", "US-ND", "US-NE", "US-OH", "US-SD", "US-WI"],
    "south": ["US-AL", "US-AR", "US-FL", "US-GA", "US-LA", "US-MS", "US-NC", "US-OK", "US-SC", "US-TN",
              "US-TX", "US-VA", "US-WV"],
    "northeast": ["US-NY", "US-PA", "US-VT"],
}  # fmt: skip
EXAMPLES = {
    "west": [("US-CA", "94103"), ("US-NV", "89501"), ("US-WA", "98101"), ("US-CO", "80202")],
    "midwest": [("US-IL", "60601"), ("US-OH", "43215"), ("US-MO", "63101")],
    "south": [("US-TX", "75201"), ("US-GA", "30303"), ("US-FL", "33101")],
    "northeast": [("US-NY", "10001"), ("US-PA", "19103"), ("US-VT", "05401")],
}
STEP = Decimal("0.0025")


def _prefixes(spec: str) -> list[str]:
    out = []
    for part in spec.split():
        lo, _, hi = part.partition("-")
        out += [f"{n:03d}" for n in range(int(lo), int(hi or lo) + 1)]
    return [p for p in out if p not in GAPS]


LOCAL = {
    prefix: (region, STEP * (1 + h("local", prefix) % int(Decimal(MAX_LOCAL[region]) / STEP)))
    for region, spec in ZIP3.items()
    for prefix in _prefixes(spec)
}


def local_csv(groups: list[str]) -> str:
    regions = {region for group in groups for region in GROUPS[group]}
    rows = [f"{p},{r},{rate}" for p, (r, rate) in sorted(LOCAL.items()) if r in regions]
    return "prefix,region,rate\n" + "\n".join(rows) + "\n"


def L(postcode: str) -> Decimal:
    return LOCAL[postcode[:3]][1]


# --- 0.9.0: round 1's history with every bugs.tsv fix applied ---------------
INIT_IMPORTS = {
    "discounts": ["Coupon"],
    "invoice": ["Invoice", "LineItem", "Totals", "compute_totals"],
    "money": ["format_money", "round_money"],
}
BASE = [
    ("2024-03-04T09:12:00Z", "chore: scaffold project", "pyproject.toml README.md .gitignore", ""),
    ("2024-03-05T10:30:00Z", "feat(money): add decimal money helpers", "invoicer/money.py tests/test_money.py", "money"),
    ("2024-03-07T14:02:00Z", "feat(tax): add sales tax, gst and vat rates", "invoicer/rates.py tests/test_rates.py", None),
    ("2024-03-11T16:45:00Z", "feat(discounts): split coupons across lines by largest remainder",
     "invoicer/discounts.py tests/test_discounts.py", "discounts money"),
    ("2024-03-14T11:20:00Z", "feat(invoice): apply coupons per line before tax",
     "invoicer/invoice.py tests/test_invoice.py tests/conftest.py", "discounts invoice money"),
    ("2024-03-18T09:55:00Z", "feat(format): render invoices as text, markdown and csv",
     "invoicer/formatting.py tests/test_formatting.py", None),
    ("2024-03-20T13:10:00Z", "feat(cli): add total, render and regions commands", "invoicer/cli.py tests/test_cli.py", None),
    ("2024-03-22T15:40:00Z", "docs: add contributing guide", "CONTRIBUTING.md", None),
    ("2024-03-27T10:05:00Z", "test(samples): add golden invoices checked by finance",
     "tests/test_samples.py tests/data/samples.json", None),
    ("2024-04-02T17:30:00Z", "chore(release): 0.9.0", "CHANGELOG.md", None),
]  # fmt: skip


def fixed_fixture() -> dict[str, str]:
    files = {
        path.relative_to(FIXTURE).as_posix(): path.read_text(encoding="utf-8")
        for path in sorted(FIXTURE.rglob("*"))
        if path.is_file() and not {"__pycache__", ".pytest_cache"} & set(path.parts)
    }
    for rel, bug, fix in BUGS:
        if bug not in files[rel]:
            raise SystemExit(f"history2: {rel} does not contain {bug!r}")
        files[rel] = files[rel].replace(bug, fix)
    return files


def init_py(modules: list[str]) -> str:
    """invoicer/__init__.py exporting only what exists yet, so every commit imports."""
    lines = ['"""invoicer: line items, coupons, regional tax and rounding."""', ""]
    lines += [f"from .{m} import {', '.join(INIT_IMPORTS[m])}" for m in modules]
    names = sorted(name for m in modules for name in INIT_IMPORTS[m])
    if names:
        lines += ["", "__all__ = [", *[f'    "{name}",' for name in names], "]"]
    else:
        lines += ["", "__all__: list[str] = []"]
    return "\n".join(lines) + '\n__version__ = "0.9.0"\n'


def release(repo: Repo) -> None:
    files = fixed_fixture()
    for date, subject, paths, init in BASE:
        for rel in paths.split():
            repo.write(rel, files[rel])
        if init is not None:
            repo.write("invoicer/__init__.py", init_py(init.split()))
        repo.commit("sam", date, subject)
    if repo.files != files:
        raise SystemExit("history2: the 0.9.0 tree differs from the fixed fixture")
    name, email = AUTHORS["sam"]
    env = {"GIT_COMMITTER_NAME": name, "GIT_COMMITTER_EMAIL": email, "GIT_COMMITTER_DATE": BASE[-1][0]}
    repo.git("tag", "-a", "v0.9.0", "-m", "invoicer 0.9.0", env=env)


# --- After 0.9.0 ---------------------------------------------------------------
CATALOG = [
    ("mug", "Ceramic mug", "standard", "12.00"),
    ("tee", "Cotton T-shirt", "standard", "19.90"),
    ("kettle", "Electric kettle", "standard", "49.00"),
    ("lamp", "Desk lamp", "standard", "34.50"),
    ("cable", "USB-C cable", "standard", "9.99"),
    ("bread", "Sourdough loaf", "food", "4.25"),
    ("coffee", "Coffee beans 1kg", "food", "18.40"),
    ("tea", "Green tea", "food", "6.75"),
    ("novel", "Paperback novel", "books", "14.99"),
    ("atlas", "World atlas", "books", "39.00"),
    ("ebook", "E-book licence", "digital", "7.99"),
    ("course", "Online course", "digital", "129.00"),
    ("vitamins", "Vitamin D", "reduced", "8.60"),
    ("gift-card", "Gift card", "exempt", "25.00"),
]
TOTALS_SCRIPT = """
import json, sys
from invoicer import Invoice, compute_totals
out = []
for data in json.load(sys.stdin):
    totals = compute_totals(Invoice.from_dict(data))
    fields = ("subtotal", "discount", "tax", "total")
    out.append({"invoice": data, "expected": {f: str(getattr(totals, f)) for f in fields}})
print(json.dumps(out, indent=2, ensure_ascii=False))
"""


def local_invoices() -> list[dict]:
    west = {r: [p for p, (owner, _) in sorted(LOCAL.items()) if owner == r] for r in GROUPS["west"]}
    invoices = []
    for i in range(1, 73):
        region = GROUPS["west"][h("loc-region", i) % len(GROUPS["west"])]
        postcode = f"{west[region][h('loc-zip', i) % len(west[region])]}{h('loc-zip5', i) % 100:02d}"
        if h("loc-plus4", i) % 6 == 0:
            postcode += f"-{h('loc-plus4-digits', i) % 10000:04d}"
        items = []
        for j in range(1 + h("loc-lines", i) % 4):
            sku, description, category, price = CATALOG[h("loc-item", i, j) % len(CATALOG)]
            cents = max(50, int(Decimal(price) * 100) + h("loc-price", i, j) % 301 - 150)
            items.append({
                "sku": sku,
                "description": description,
                "quantity": 1 + h("loc-qty", i, j) % 3,
                "unit_price": str(Decimal(cents) / 100),
                "category": category,
            })  # fmt: skip
        invoice = {"number": f"LOC-{i:04d}", "region": region, "postcode": postcode, "items": items}
        kind = h("loc-coupon", i) % 10
        if kind < 3:
            value = ["5", "10", "12.5", "15", "20", "25"][h("loc-pct", i) % 6]
            invoice["coupon"] = {"code": f"P{value.replace('.', '')}", "kind": "percent", "value": value}
        elif kind < 5:
            value = ["2.00", "5.00", "7.50", "10.00"][h("loc-fixed", i) % 4]
            invoice["coupon"] = {"code": f"F{value.split('.')[0]}", "kind": "fixed", "value": value}
        invoices.append(invoice)
    return invoices


def localtax_tests(groups: list[str]) -> str:
    params = "\n".join(
        f'        ("{region}", "{postcode}", "{L(postcode)}"),' for g in groups for region, postcode in EXAMPLES[g]
    )
    return (
        r'''from decimal import Decimal as D

import pytest

from invoicer.localtax import LocalTaxError, local_rate, zip_prefix


@pytest.mark.parametrize("postcode, prefix", [("94103", "941"), (" 94103 ", "941"), ("94103-1234", "941"), ("00501", "005")])
def test_zip_prefix(postcode, prefix):
    assert zip_prefix(postcode) == prefix


@pytest.mark.parametrize("postcode", ["9410", "941033", "ABCDE", "94103-12", ""])
def test_zip_prefix_rejects_malformed(postcode):
    with pytest.raises(LocalTaxError):
        zip_prefix(postcode)


@pytest.mark.parametrize(
    "region, postcode, rate",
    [
'''
        + params
        + r'''
    ],
)
def test_local_rate(region, postcode, rate):
    assert local_rate(region, postcode) == D(rate)


def test_local_rate_is_case_insensitive():
    assert local_rate("us-ca", "94103") == local_rate("US-CA", "94103")


def test_local_rate_is_zero_outside_the_us():
    assert local_rate("DE", "10115") == D("0")


def test_unknown_prefix_has_no_local_rate():
    assert local_rate("US-CA", "92901") == D("0")


def test_postcode_in_another_state():
    with pytest.raises(LocalTaxError, match="US-NV"):
        local_rate("US-CA", "89501")
'''
    )


LOCALTAX_PY = r'''"""Local sales tax for US postcodes.

Illustrative rates for development and tests only. Each row of
``data/local_us.csv`` maps the first three digits of a ZIP code to the
combined county and city rate that is added on top of the state rate.
"""

from __future__ import annotations

import csv
import re
from decimal import Decimal
from pathlib import Path

DATA = Path(__file__).parent / "data" / "local_us.csv"
ZIP = re.compile(r"(\d{5})(-\d{4})?")


class LocalTaxError(ValueError):
    """Raised for postcodes that cannot be matched to a local rate."""


def _load(path: Path = DATA) -> dict[str, tuple[str, Decimal]]:
    with path.open(encoding="utf-8", newline="") as handle:
        return {row["prefix"]: (row["region"], Decimal(row["rate"])) for row in csv.DictReader(handle)}


LOCAL_RATES = _load()


def zip_prefix(postcode: str) -> str:
    """First three digits of a US ZIP or ZIP+4 code."""
    match = ZIP.fullmatch(postcode.strip())
    if not match:
        raise LocalTaxError(f"not a US ZIP code: {postcode!r}")
    return match.group(1)[:3]


def local_rate(region: str, postcode: str) -> Decimal:
    """Local rate for ``postcode`` in ``region``; zero outside the US."""
    region = region.upper()
    if not region.startswith("US-"):
        return Decimal("0")
    entry = LOCAL_RATES.get(zip_prefix(postcode))
    if entry is None:
        return Decimal("0")
    owner, rate = entry
    if owner != region:
        raise LocalTaxError(f"ZIP {postcode} is in {owner}, not {region}")
    return rate
'''


def part1(repo: Repo) -> None:
    repo.write(".github/workflows/ci.yml", """name: ci

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        python: ["3.11", "3.12", "3.13"]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: ${{ matrix.python }}
      - run: python -m pip install -e ".[test]"
      - run: python -m pytest
""")
    repo.commit("sam", "2024-04-04T10:15:00Z", "chore: add a ci workflow for python 3.11 to 3.13",
                "CONTRIBUTING.md promises CI on 3.11, 3.12 and 3.13 but nothing ran it.")

    m = "invoicer/money.py"
    for code, symbol, anchor in (("MXN", "MX$", "JPY"), ("NZD", "NZ$", "NOK"), ("SGD", "S$", "SEK"), ("ZAR", "R ", "USD")):
        repo.resub(m, rf'(    "{anchor}": \d,\n)', rf'\1    "{code}": 2,\n', 1)
        repo.resub(m, rf'(    "{anchor}": "[^"]*",\n)', rf'\1    "{code}": "{symbol}",\n', 1)
    repo.append("tests/test_money.py", '''

@pytest.mark.parametrize(
    "amount, currency, expected",
    [("1234.5", "NZD", "NZ$1,234.50"), ("19.9", "SGD", "S$19.90"), ("250", "MXN", "MX$250.00"), ("-7.25", "ZAR", "-R 7.25")],
)
def test_format_money_new_currencies(amount, currency, expected):
    assert format_money(amount, currency) == expected
''')
    repo.commit("priya", "2024-04-08T09:40:00Z", "feat(money): add nzd, sgd, mxn and zar currencies",
                "Needed for the APAC and LATAM storefronts launching next quarter.")

    repo.after("invoicer/rates.py", '        _region("AU", "Australia", "AUD", True, "0.10", food="0"),\n', '''\
        _region("NZ", "New Zealand", "NZD", True, "0.15"),
        _region("SG", "Singapore", "SGD", True, "0.09"),
        _region("MX", "Mexico", "MXN", True, "0.16", food="0", books="0"),
        _region("ZA", "South Africa", "ZAR", True, "0.15", food="0"),
''')
    repo.append("tests/test_rates.py", '''

@pytest.mark.parametrize(
    "code, currency, standard", [("NZ", "NZD", "0.15"), ("SG", "SGD", "0.09"), ("MX", "MXN", "0.16"), ("ZA", "ZAR", "0.15")]
)
def test_new_regions(code, currency, standard):
    region = get_region(code)
    assert (region.currency, region.standard, region.inclusive) == (currency, D(standard), True)


def test_mexico_food_and_books_are_zero_rated():
    mexico = get_region("MX")
    assert mexico.rate_for("food") == D("0")
    assert mexico.rate_for("books") == D("0")
''')
    repo.append("tests/test_invoice.py", '''

def test_new_zealand_gst_is_included(make_invoice, item):
    totals = compute_totals(make_invoice("NZ", item("wool", "115.00")))
    assert totals.tax == D("15.00")
    assert totals.total == D("115.00")
''')
    repo.commit("priya", "2024-04-10T14:05:00Z", "feat(tax): add new zealand, singapore, mexico and south africa",
                "All four quote prices with tax included, like the EU regions.")

    f = "invoicer/formatting.py"
    repo.sub(f, "import io\n", "import io\nimport json\n")
    repo.append(f, '''

def render_json(invoice: Invoice, totals: Totals | None = None) -> str:
    """Machine readable totals; amounts are strings so no precision is lost."""
    totals = totals or compute_totals(invoice)
    data = {
        "invoice": invoice.number,
        "region": invoice.region,
        "currency": totals.currency,
        "lines": [
            {"sku": line.sku, "gross": str(line.gross), "discount": str(line.discount)}
            for line in totals.lines
        ],
        "subtotal": str(totals.subtotal),
        "discount": str(totals.discount),
        "tax": str(totals.tax),
        "total": str(totals.total),
    }
    return json.dumps(data, indent=2) + "\\n"
''')
    t = "tests/test_formatting.py"
    repo.sub(t, "import io\n", "import io\nimport json\n")
    repo.sub(t, "render_csv, render_markdown, render_text", "render_csv, render_json, render_markdown, render_text")
    repo.append(t, '''

def test_json_totals(make_invoice, item):
    data = json.loads(render_json(make_invoice("US-OR", item("pen", "2.50", 4))))
    assert data["currency"] == "USD"
    assert data["total"] == "10.00"
    assert data["lines"] == [{"sku": "pen", "gross": "10.00", "discount": "0"}]
''')
    repo.commit("tomas", "2024-04-11T11:30:00Z", "feat(format): add a json renderer",
                "The billing dashboard wants totals without scraping the text output.")

    c = "invoicer/cli.py"
    repo.sub(c, "render_csv, render_markdown, render_text", "render_csv, render_json, render_markdown, render_text")
    repo.sub(c, '"csv": render_csv}', '"csv": render_csv, "json": render_json}')
    repo.append("tests/test_cli.py", '''

def test_render_json(tmp_path, capsys):
    assert main(["render", write_invoice(tmp_path, INVOICE), "--format", "json"]) == 0
    assert json.loads(capsys.readouterr().out)["total"] == "10.00"
''')
    repo.commit("tomas", "2024-04-12T16:20:00Z", "feat(cli): add a json format to the render command")

    repo.write("docs/cli.md", cli_md(6))
    repo.after("README.md", "python -m invoicer.cli regions --inclusive\n```\n",
               "\nEvery command and option is described in [docs/cli.md](docs/cli.md).\n")
    repo.commit("amara", "2024-04-15T10:00:00Z", "docs: add a cli reference")

    repo.write("invoicer/localtax.py", LOCALTAX_PY)
    repo.write("invoicer/data/local_us.csv", local_csv(["west"]))
    repo.sub("pyproject.toml", "[tool.pytest.ini_options]",
             '[tool.setuptools.package-data]\ninvoicer = ["data/*.csv"]\n\n[tool.pytest.ini_options]')
    repo.write("tests/test_localtax.py", localtax_tests(["west"]))
    repo.commit("sam", "2024-04-17T13:45:00Z", "feat(tax): add local sales tax rates for western states", """
        Counties and cities add their own sales tax on top of the state rate.
        Keep one combined local rate per three-digit ZIP prefix in
        data/local_us.csv, starting with the western states where most of our
        US orders ship. Nothing uses the table yet.""")

    i = "invoicer/invoice.py"
    repo.after(i, "from .discounts import Coupon, allocate, discount_amount\n", "from .localtax import local_rate\n")
    repo.sub(i, '    notes: str = ""\n\n    def add(', '    notes: str = ""\n    postcode: str | None = None\n\n    def add(')
    repo.after(i, '            notes=data.get("notes", ""),\n', '            postcode=data.get("postcode"),\n')
    repo.after(i, '            data["notes"] = self.notes\n', '        if self.postcode:\n            data["postcode"] = self.postcode\n')
    repo.sub(i, "    across lines, and the tax is rounded once for the whole invoice.\n",
             "    across lines, and the tax is rounded once for the whole invoice. With a\n"
             "    postcode, local sales tax is added to the rate of every taxable line.\n")
    repo.after(i, "    currency = region.currency\n",
               '    local = local_rate(region.code, invoice.postcode) if invoice.postcode else Decimal("0")\n')
    repo.after(i, "        rate = region.rate_for(item.category)\n", "        if rate and local:\n            rate += local\n")
    repo.sub("tests/conftest.py", 'number="INV-TEST"):\n        return Invoice(number=number, region=region, items=list(items), coupon=coupon)',
             'number="INV-TEST", postcode=None):\n'
             "        return Invoice(number=number, region=region, items=list(items), coupon=coupon, postcode=postcode)")
    tax = money(Decimal("24.00") * (Decimal("0.0725") + L("94103")))
    repo.append("tests/test_invoice.py", f'''

def test_local_tax_is_added_for_postcode(make_invoice, item):
    invoice = make_invoice("US-CA", item("mug", "12.00", 2), item("bread", "4.00", category="food"), postcode="94103")
    totals = compute_totals(invoice)
    assert totals.tax == D("{tax}")
    assert totals.total == D("{Decimal("28.00") + tax}")


def test_postcode_round_trips(make_invoice, item):
    invoice = make_invoice("US-CA", item("mug", "12.00"), postcode="94103-1234")
    assert Invoice.from_dict(invoice.to_dict()) == invoice


def test_postcode_is_ignored_outside_the_us(make_invoice, item):
    totals = compute_totals(make_invoice("DE", item("lamp", "119.00"), postcode="10115"))
    assert totals.tax == D("19.00")
''')
    repo.commit("sam", "2024-04-19T09:25:00Z", "feat(invoice): apply local sales tax when an invoice has a postcode", """
        US invoices undercharged tax wherever a county or city adds its own
        rate. An invoice can now carry a postcode; the local rate for it is
        added to the state rate of every taxable line. Zero-rated lines stay
        untaxed.""")

    c = "invoicer/cli.py"
    repo.sub(c, '''def _load(path: str) -> Invoice:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    return Invoice.from_dict(data)''', '''def _load(path: str, postcode: str | None = None) -> Invoice:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    invoice = Invoice.from_dict(data)
    if postcode:
        invoice.postcode = postcode
    return invoice''')
    repo.sub(c, "compute_totals(_load(args.invoice))", "compute_totals(_load(args.invoice, args.postcode))")
    repo.sub(c, "RENDERERS[args.format](_load(args.invoice))", "RENDERERS[args.format](_load(args.invoice, args.postcode))")
    postcode_arg = '.add_argument("--postcode", help="US ZIP code for local sales tax")\n'
    repo.after(c, '    total.add_argument("invoice", help="path to an invoice JSON file")\n', "    total" + postcode_arg)
    repo.after(c, '    render.add_argument("invoice", help="path to an invoice JSON file")\n', "    render" + postcode_arg)
    due = money(Decimal("10.00") * (1 + Decimal("0.065") + L("98101")))
    repo.append("tests/test_cli.py", f'''

def test_total_with_postcode(tmp_path, capsys):
    data = dict(INVOICE, region="US-WA")
    assert main(["total", write_invoice(tmp_path, data), "--postcode", "98101"]) == 0
    assert capsys.readouterr().out.strip() == "${due}"


def test_postcode_in_another_state_exits_2(tmp_path, capsys):
    data = dict(INVOICE, region="US-WA")
    assert main(["total", write_invoice(tmp_path, data), "--postcode", "94103"]) == 2
    assert "not US-WA" in capsys.readouterr().err
''')
    repo.commit("tomas", "2024-04-22T15:10:00Z", "feat(cli): add a postcode option to total and render",
                "Lets support quote a total for an order before the invoice exists.")

    samples = repo.python("-c", TOTALS_SCRIPT, stdin=json.dumps(local_invoices()))
    repo.write("tests/data/local_samples.json", samples)
    repo.write("tests/test_local_samples.py", repo.files["tests/test_samples.py"]
               .replace('"samples.json"', '"local_samples.json"').replace("def test_sample_totals", "def test_local_sample_totals"))
    repo.sub("README.md", "`tests/data/samples.json` holds golden invoices checked by the finance team.\n",
             "`tests/data/samples.json` and `tests/data/local_samples.json` hold golden\ninvoices checked by the finance team.\n")
    repo.sub("CONTRIBUTING.md", """`tests/data/samples.json` holds golden invoices. Their expected totals were
checked by hand by the finance team. If a sample disagrees with the code,
assume the code is wrong. Never regenerate the samples from the code.""",
             """`tests/data/samples.json` and `tests/data/local_samples.json` hold golden
invoices. Their expected totals were checked by hand by the finance team. If
a sample disagrees with the code, assume the code is wrong. Never regenerate
the samples from the code.""")
    repo.commit("amara", "2024-04-24T11:50:00Z", "test(samples): add golden invoices with local sales tax", """
        Seventy-two invoices from western states with postcodes, coupons and
        zero-rated lines, checked line by line by finance against the county
        rate sheets.""")


REGIONS_SCRIPT = """
import csv, sys
from invoicer.rates import REGIONS
writer = csv.writer(sys.stdout, lineterminator="\\n")
columns = ("reduced", "food", "books", "digital")
writer.writerow(["code", "name", "currency", "inclusive", "standard", *columns])
for r in REGIONS.values():
    writer.writerow([r.code, r.name, r.currency, "yes" if r.inclusive else "no", r.standard, *(r.overrides.get(c, "") for c in columns)])
"""


def part2(repo: Repo) -> None:
    m = "invoicer/money.py"
    repo.sub(m, "from decimal import ROUND_HALF_UP, Decimal", "from decimal import ROUND_HALF_EVEN, Decimal")
    repo.sub(m, '''def quantum(currency: str) -> Decimal:
    """Smallest unit for ``currency``: ``Decimal('0.01')`` for USD."""
    return Decimal(1).scaleb(-exponent(currency))


def round_money(amount: object, currency: str) -> Decimal:
    """Round half up (away from zero) to the currency's minor unit."""
    return to_decimal(amount).quantize(quantum(currency), rounding=ROUND_HALF_UP)
''', '''def quantize(value: object, places: int) -> Decimal:
    """Round ``value`` to ``places`` decimal places."""
    return to_decimal(value).quantize(Decimal(1).scaleb(-places), rounding=ROUND_HALF_EVEN)


def quantum(currency: str) -> Decimal:
    """Smallest unit for ``currency``: ``Decimal('0.01')`` for USD."""
    return Decimal(1).scaleb(-exponent(currency))


def round_money(amount: object, currency: str) -> Decimal:
    """Round half up (away from zero) to the currency's minor unit."""
    return quantize(amount, exponent(currency))


def percent(rate: object, places: int = 3) -> str:
    """A rate as a percentage: ``percent("0.0725")`` is ``"7.250%"``."""
    return f"{quantize(to_decimal(rate) * 100, places)}%"
''')
    c = "invoicer/cli.py"
    repo.sub(c, "from .money import format_money\n", "from .money import format_money, percent\n")
    repo.sub(c, "{region.standard * 100:>7.3f}%", "{percent(region.standard):>8}")
    t = "tests/test_money.py"
    repo.sub(t, "format_money, quantum, round_money", "format_money, percent, quantize, quantum, round_money")
    repo.append(t, '''

@pytest.mark.parametrize("value, places, expected", [("1.23456", 2, "1.23"), ("1.2346", 3, "1.235"), ("41.6", 0, "42")])
def test_quantize(value, places, expected):
    assert quantize(value, places) == Decimal(expected)


@pytest.mark.parametrize("rate, expected", [("0.0725", "7.250%"), ("0.06875", "6.875%"), ("0", "0.000%")])
def test_percent(rate, expected):
    assert percent(rate) == expected
''')
    repo.commit("priya", "2024-04-26T17:05:00Z", "refactor(money): share one quantize helper across currencies", """
        Amounts and the rates shown by the regions command were rounded in
        two places with two different calls. Route both through quantize() so
        a change to rounding or display precision only touches one function.
        percent() replaces the hand-rolled formatting in the cli.""")

    d = "invoicer/discounts.py"
    repo.after(d, '    min_subtotal: Decimal = Decimal("0")\n', "    max_discount: Decimal | None = None\n")
    repo.after(d, '            raise CouponError("percent coupons cannot exceed 100")\n', '''\
        if self.max_discount is not None and self.max_discount <= 0:
            raise CouponError("max discount must be positive")
''')
    repo.sub(d, '''        return cls(
            code=data["code"],''', '''        cap = data.get("max_discount")
        return cls(
            code=data["code"],''')
    repo.after(d, '''            min_subtotal=to_decimal(data.get("min_subtotal", "0")),\n''',
               "            max_discount=to_decimal(cap) if cap is not None else None,\n")
    repo.sub(d, '''        return {
            "code": self.code,
            "kind": self.kind,
            "value": str(self.value),
            "min_subtotal": str(self.min_subtotal),
        }''', '''        data = {
            "code": self.code,
            "kind": self.kind,
            "value": str(self.value),
            "min_subtotal": str(self.min_subtotal),
        }
        if self.max_discount is not None:
            data["max_discount"] = str(self.max_discount)
        return data''')
    repo.after(d, "        amount = subtotal * coupon.value / Decimal(100)\n", '''\
        if coupon.max_discount is not None:
            amount = min(amount, coupon.max_discount)
''')
    repo.append("tests/test_discounts.py", '''

def test_percent_coupon_capped_by_max_discount():
    coupon = Coupon("HALF", "percent", D("50"), max_discount=D("15.00"))
    assert discount_amount(coupon, D("80.00"), "USD") == D("15.00")


def test_max_discount_not_reached():
    coupon = Coupon("HALF", "percent", D("50"), max_discount=D("15.00"))
    assert discount_amount(coupon, D("20.00"), "USD") == D("10.00")


def test_max_discount_round_trips():
    coupon = Coupon("HALF", "percent", D("50"), max_discount=D("15.00"))
    assert Coupon.from_dict(coupon.to_dict()) == coupon


def test_max_discount_must_be_positive():
    with pytest.raises(CouponError):
        Coupon("HALF", "percent", D("50"), max_discount=D("0"))
''')
    repo.commit("tomas", "2024-04-29T10:35:00Z", "feat(discounts): cap percent coupons with an optional max discount",
                "Marketing wants 50% off campaigns that cannot cost more than a set amount per order.")

    repo.write("invoicer/data/local_us.csv", local_csv(["west", "midwest"]))
    repo.write("tests/test_localtax.py", localtax_tests(["west", "midwest"]))
    repo.commit("sam", "2024-05-01T14:20:00Z", "feat(tax): add local rates for midwestern states")

    repo.write("invoicer/data/local_us.csv", local_csv(["west", "midwest", "south"]))
    repo.write("tests/test_localtax.py", localtax_tests(["west", "midwest", "south"]))
    repo.commit("amara", "2024-05-03T09:55:00Z", "feat(tax): add local rates for southern states")

    c = "invoicer/cli.py"
    repo.sub(c, "from .rates import UnknownRegion, regions", "from .rates import CATEGORIES, UnknownRegion, get_region, regions")
    repo.sub(c, "\n\ndef build_parser()", '''

def cmd_rates(args: argparse.Namespace) -> int:
    region = get_region(args.region)
    kind = "tax included" if region.inclusive else "tax added"
    print(f"{region.code} {region.name} ({region.currency}, {kind})")
    for category in CATEGORIES:
        print(f"  {category:<9} {percent(region.rate_for(category)):>8}")
    return 0


def build_parser()''')
    repo.after(c, "    listing.set_defaults(func=cmd_regions)\n", '''
    rates = sub.add_parser("rates", help="list category rates for a region")
    rates.add_argument("region", help="region code, e.g. US-CA or DE")
    rates.set_defaults(func=cmd_rates)
''')
    repo.append("tests/test_cli.py", f'''

def test_rates_lists_every_category(capsys):
    assert main(["rates", "DE"]) == 0
    out = capsys.readouterr().out
    assert out.splitlines()[0] == "DE Germany (EUR, tax included)"
    assert "{f"  {'books':<9} {'7.000%':>8}"}" in out
    assert len(out.splitlines()) == 7


def test_rates_zero_rated_food(capsys):
    assert main(["rates", "US-CA"]) == 0
    assert "{f"  {'food':<9} {'0.000%':>8}"}" in capsys.readouterr().out


def test_rates_unknown_region_exits_2(capsys):
    assert main(["rates", "XX"]) == 2
''')
    repo.commit("tomas", "2024-05-06T16:40:00Z", "feat(cli): add a rates command that lists category rates for a region",
                "Support keeps asking which categories are reduced or zero-rated where.")

    repo.write("docs/local-tax.md", local_tax_md(["west", "midwest", "south"]))
    repo.write("docs/cli.md", cli_md(16))
    repo.sub("README.md", "tax (US sales tax, Canadian GST/HST, VAT) and currency rounding.\n",
             "tax (US state and local sales tax, Canadian GST/HST, VAT) and currency\nrounding.\n")
    repo.after("README.md", '  "coupon": { "code": "SAVE20", "kind": "percent", "value": "20" }\n}\n```\n', '''
Add `"postcode": "98101"` to a US invoice, or pass `--postcode`, to add local
sales tax. See [docs/local-tax.md](docs/local-tax.md).
''')
    repo.after("CONTRIBUTING.md", "- To add a region, add one `_region(...)` line in the right block and a test.\n", '''\
- Local sales tax for US postcodes lives in `invoicer/data/local_us.csv`, one
  row per three-digit ZIP prefix. See `docs/local-tax.md`.
''')
    repo.commit("priya", "2024-05-08T11:15:00Z", "docs: explain local sales tax and postcodes")

    repo.write("invoicer/data/local_us.csv", local_csv(list(GROUPS)))
    repo.write("tests/test_localtax.py", localtax_tests(list(GROUPS)))
    repo.write("docs/local-tax.md", local_tax_md(list(GROUPS)))
    repo.commit("sam", "2024-05-10T13:30:00Z", "feat(tax): add local rates for northeastern states",
                "New York, Pennsylvania and Vermont. Every state with local sales tax that we ship to is now covered.")

    i = "invoicer/invoice.py"
    repo.after(i, "from dataclasses import dataclass, field\n", "from datetime import date, timedelta\n")
    repo.sub(i, "    postcode: str | None = None\n\n    def add(", '''    postcode: str | None = None
    issued: date | None = None
    terms_days: int = 30

    def __post_init__(self) -> None:
        if self.terms_days < 0:
            raise InvoiceError(f"{self.number}: payment terms cannot be negative")

    @property
    def due(self) -> date | None:
        """Payment due date, or ``None`` for invoices without an issue date."""
        return self.issued + timedelta(days=self.terms_days) if self.issued else None

    def add(''')
    repo.after(i, '            postcode=data.get("postcode"),\n', '''\
            issued=date.fromisoformat(data["issued"]) if data.get("issued") else None,
            terms_days=int(data.get("terms_days", 30)),
''')
    repo.after(i, '            data["postcode"] = self.postcode\n', '''\
        if self.issued:
            data["issued"] = self.issued.isoformat()
        if self.terms_days != 30:
            data["terms_days"] = self.terms_days
''')
    t = "tests/test_invoice.py"
    repo.sub(t, "from decimal import Decimal as D\n", "from datetime import date\nfrom decimal import Decimal as D\n")
    repo.append(t, '''

def test_due_date(make_invoice, item):
    invoice = make_invoice("US-CA", item("mug", "12.00"))
    invoice.issued = date(2024, 5, 13)
    assert invoice.due == date(2024, 6, 12)


def test_no_due_date_without_issue_date(make_invoice, item):
    assert make_invoice("US-CA", item("mug", "12.00")).due is None


def test_negative_terms_rejected():
    with pytest.raises(InvoiceError):
        Invoice("INV-X", "US-CA", terms_days=-1)


def test_dates_round_trip(make_invoice, item):
    invoice = make_invoice("GB", item("tea", "3.50"))
    invoice.issued = date(2024, 5, 13)
    invoice.terms_days = 14
    assert Invoice.from_dict(invoice.to_dict()) == invoice
''')
    repo.commit("tomas", "2024-05-13T10:05:00Z", "feat(invoice): add issue date and payment terms",
                "Net 30 unless the invoice says otherwise.")

    f = "invoicer/formatting.py"
    repo.after(f, '    out = [f"Invoice {invoice.number} ({invoice.region})", "=" * WIDTH]\n', '''\
    if invoice.issued:
        out.insert(1, f"Issued {invoice.issued.isoformat()}, due {invoice.due.isoformat()}")
''')
    repo.after(f, '    out.append(f"| **Total** | | **{format_money(totals.total, currency)}** |")\n', '''\
    if invoice.issued:
        out += ["", f"Due {invoice.due.isoformat()} (issued {invoice.issued.isoformat()})"]
''')
    t = "tests/test_formatting.py"
    repo.sub(t, "from decimal import Decimal as D\n", "from datetime import date\nfrom decimal import Decimal as D\n")
    repo.append(t, '''

def test_text_shows_due_date(make_invoice, item):
    invoice = make_invoice("US-OR", item("pen", "2.50", 4))
    invoice.issued = date(2024, 5, 15)
    assert "Issued 2024-05-15, due 2024-06-14" in render_text(invoice)


def test_markdown_shows_due_date(make_invoice, item):
    invoice = make_invoice("US-OR", item("pen", "2.50", 4))
    invoice.issued = date(2024, 5, 15)
    invoice.terms_days = 14
    assert "Due 2024-05-29 (issued 2024-05-15)" in render_markdown(invoice)
''')
    repo.commit("amara", "2024-05-15T15:25:00Z", "feat(format): show due dates on text and markdown invoices")

    repo.write("invoicer/data/regions.csv", repo.python("-c", REGIONS_SCRIPT))
    r = "invoicer/rates.py"
    repo.sub(r, "and are not kept in sync with any jurisdiction.\n", """and are not kept in sync with any jurisdiction. The rates live in
``data/regions.csv`` so finance can review them without reading Python.
""")
    repo.sub(r, "from dataclasses import dataclass, field\nfrom decimal import Decimal\n",
             "import csv\nfrom dataclasses import dataclass, field\nfrom decimal import Decimal\nfrom pathlib import Path\n")
    repo.after(r, '"digital", "exempt")\n', 'DATA = Path(__file__).parent / "data" / "regions.csv"\n')
    repo.sub(r, "return self.overrides.get(category, self.standard)", "return self.overrides.get(category) or self.standard")
    repo.resub(r, r"(?s)def _region\(.*?\n}\n(?=\n\ndef get_region)", '''def _parse(row: dict[str, str]) -> Region:
    """One CSV row; an empty category cell means the standard rate applies."""
    return Region(
        code=row["code"],
        name=row["name"],
        currency=row["currency"],
        inclusive=row["inclusive"] == "yes",
        standard=Decimal(row["standard"]),
        overrides={category: Decimal(row[category]) for category in CATEGORIES[1:-1] if row[category]},
    )


def load_regions(path: Path = DATA) -> dict[str, Region]:
    """Regions keyed by code, in file order."""
    with path.open(encoding="utf-8", newline="") as handle:
        return {region.code: region for region in map(_parse, csv.DictReader(handle))}


REGIONS: dict[str, Region] = load_regions()
''', 1)
    t = "tests/test_rates.py"
    repo.sub(t, "from invoicer.rates import CATEGORIES, REGIONS, UnknownRegion, get_region, regions\n",
             "from invoicer.money import exponent\n"
             "from invoicer.rates import CATEGORIES, REGIONS, UnknownRegion, get_region, load_regions, regions\n")
    repo.append(t, r'''

HEADER = "code,name,currency,inclusive,standard,reduced,food,books,digital\n"


def test_load_regions_reads_every_row(tmp_path):
    path = tmp_path / "regions.csv"
    path.write_text(HEADER + "XA,Example A,EUR,yes,0.20,0.10,,0.05,\nXB,Example B,USD,no,0.07,,,,0.01\n", encoding="utf-8")
    loaded = load_regions(path)
    assert list(loaded) == ["XA", "XB"]
    assert loaded["XA"].inclusive and not loaded["XB"].inclusive
    assert loaded["XA"].rate_for("books") == D("0.05")
    assert loaded["XB"].rate_for("digital") == D("0.01")


def test_empty_cell_means_standard_rate(tmp_path):
    path = tmp_path / "regions.csv"
    path.write_text(HEADER + "XC,Example C,GBP,yes,0.20,,,,\n", encoding="utf-8")
    assert load_regions(path)["XC"].rate_for("food") == D("0.20")


def test_every_region_uses_a_known_currency():
    assert all(exponent(region.currency) >= 0 for region in REGIONS.values())
''')
    repo.sub("CONTRIBUTING.md", "Rates in `invoicer/rates.py` are illustrative", "Rates in `invoicer/data/regions.csv` are illustrative")
    repo.sub("CONTRIBUTING.md", "- To add a region, add one `_region(...)` line in the right block and a test.\n", '''\
- To add a region, add one row to `invoicer/data/regions.csv` and a test.
  Leave a category cell empty when the standard rate applies.
''')
    repo.commit("priya", "2024-05-17T12:10:00Z", "refactor(tax): load region rates from a csv file", """
        Finance asked to review rates in a spreadsheet instead of Python.
        Rates now live in data/regions.csv, one row per region, and an empty
        category cell falls back to the standard rate. Region objects and
        lookups are unchanged.""")


REGIONS_TABLE_PY = r'''"""Print docs/regions.md from invoicer/data/regions.csv.

    python tools/regions_table.py > docs/regions.md
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from invoicer.money import percent  # noqa: E402
from invoicer.rates import CATEGORIES, regions  # noqa: E402

COLUMNS = CATEGORIES[:-1]


def main() -> None:
    print("# Tax regions")
    print()
    print("Generated by `tools/regions_table.py` from `invoicer/data/regions.csv`; do not")
    print("edit by hand. A dash means the category uses the standard rate. Exempt items")
    print("are never taxed. Rates are illustrative and are not tax advice.")
    print()
    print("| Code | Region | Currency | Tax | " + " | ".join(c.title() for c in COLUMNS) + " |")
    print("| --- | --- | --- | --- |" + " ---: |" * len(COLUMNS))
    for region in regions():
        cells = [percent(region.standard)]
        cells += [percent(region.overrides[c]) if c in region.overrides else "-" for c in COLUMNS[1:]]
        style = "included" if region.inclusive else "added"
        print(f"| {region.code} | {region.name} | {region.currency} | {style} | " + " | ".join(cells) + " |")


if __name__ == "__main__":
    main()
'''
LOCAL_DATA_TESTS = '''import csv
from decimal import Decimal as D

import pytest

from invoicer.localtax import DATA
from invoicer.rates import REGIONS

with DATA.open(encoding="utf-8", newline="") as handle:
    ROWS = list(csv.DictReader(handle))


def test_header():
    assert list(ROWS[0]) == ["prefix", "region", "rate"]


def test_prefixes_are_unique_and_sorted():
    prefixes = [row["prefix"] for row in ROWS]
    assert prefixes == sorted(set(prefixes))


def test_every_state_with_local_tax_has_rows():
    assert len({row["region"] for row in ROWS}) == 36


@pytest.mark.parametrize("row", ROWS, ids=[row["prefix"] for row in ROWS])
def test_row_is_valid(row):
    assert len(row["prefix"]) == 3 and row["prefix"].isdigit()
    assert row["region"] in REGIONS and row["region"].startswith("US-")
    assert D("0") < D(row["rate"]) <= D("0.08")
'''


def part3(repo: Repo) -> None:
    r = "invoicer/rates.py"
    repo.sub(r, "    overrides: dict[str, Decimal] = field(default_factory=dict)\n\n", '''\
    overrides: dict[str, Decimal] = field(default_factory=dict)

    @property
    def country(self) -> str:
        """ISO country code: ``US`` for ``US-CA``, ``DE`` for ``DE``."""
        return self.code.split("-")[0]

''')
    repo.sub(r, '''def regions(*, inclusive: bool | None = None) -> list[Region]:
    """All regions, optionally only tax-inclusive or tax-exclusive ones."""
    return [region for region in REGIONS.values() if inclusive is None or region.inclusive == inclusive]''',
             '''def regions(*, inclusive: bool | None = None, country: str | None = None) -> list[Region]:
    """All regions, optionally filtered by tax style and country."""
    return [
        region
        for region in REGIONS.values()
        if (inclusive is None or region.inclusive == inclusive)
        and (country is None or region.country == country.upper())
    ]''')
    repo.append("tests/test_rates.py", '''

def test_region_country():
    assert get_region("US-CA").country == "US"
    assert get_region("DE").country == "DE"


def test_regions_by_country():
    canada = regions(country="ca")
    assert len(canada) == 10
    assert all(region.code.startswith("CA-") for region in canada)
''')
    repo.commit("sam", "2024-05-20T09:45:00Z", "feat(tax): filter regions by country")

    c = "invoicer/cli.py"
    repo.sub(c, "regions(inclusive=args.inclusive)", "regions(inclusive=args.inclusive, country=args.country)")
    repo.after(c, 'default=None, help="only tax-inclusive regions")\n',
               '    listing.add_argument("--country", help="only regions in this country, e.g. US or CA")\n')
    repo.append("tests/test_cli.py", '''

def test_regions_by_country(capsys):
    assert main(["regions", "--country", "CA"]) == 0
    out = capsys.readouterr().out
    assert "Ontario" in out
    assert "California" not in out
    assert len(out.splitlines()) == 10
''')
    repo.commit("tomas", "2024-05-22T14:55:00Z", "feat(cli): add a country option to the regions command")

    repo.write("tools/regions_table.py", REGIONS_TABLE_PY)
    repo.write("docs/regions.md", repo.python("tools/regions_table.py"))
    repo.after("README.md", "Every command and option is described in [docs/cli.md](docs/cli.md).\n",
               "[docs/regions.md](docs/regions.md) lists every tax region and its rates.\n")
    repo.after("CONTRIBUTING.md", "  Leave a category cell empty when the standard rate applies.\n", '''\
- After changing `regions.csv`, regenerate the region table with
  `python tools/regions_table.py > docs/regions.md`.
''')
    repo.commit("amara", "2024-05-24T10:30:00Z", "docs: add a generated table of tax regions",
                "Finance reviews rate changes from this table, so it is generated from the CSV rather than kept by hand.")

    repo.write("tests/test_local_data.py", LOCAL_DATA_TESTS)
    repo.commit("sam", "2024-05-27T16:05:00Z", "test(tax): check local rate data for duplicates and bounds",
                "The table is edited by hand; catch duplicated prefixes, unknown states and rates above any real local rate.")

    lt = "invoicer/localtax.py"
    repo.after(lt, "from decimal import Decimal\n", "from functools import cache\n")
    repo.sub(lt, "LOCAL_RATES = _load()\n", '''@cache
def local_rates() -> dict[str, tuple[str, Decimal]]:
    """The prefix table, read from disk on first use."""
    return _load()
''')
    repo.sub(lt, "entry = LOCAL_RATES.get(", "entry = local_rates().get(")
    t = "tests/test_localtax.py"
    repo.sub(t, "import LocalTaxError, local_rate, zip_prefix", "import LocalTaxError, local_rate, local_rates, zip_prefix")
    repo.append(t, '''

def test_table_is_read_once():
    assert local_rates() is local_rates()
''')
    repo.commit("priya", "2024-05-29T11:20:00Z", "perf(tax): load local rates on first use",
                "Importing invoicer read the whole postcode table, even for EU-only workloads. Read it on the first local lookup instead.")

    c = "invoicer/cli.py"
    repo.after(c, "from .invoice import Invoice, compute_totals\n", "from .localtax import local_rate\n")
    repo.sub(c, "\n\ndef build_parser()", '''

def cmd_local(args: argparse.Namespace) -> int:
    region = get_region(args.region)
    if region.country != "US":
        raise ValueError(f"local sales tax applies to US regions only, not {region.code}")
    local = local_rate(region.code, args.postcode)
    combined = region.standard + local
    print(f"{region.code} {args.postcode}: state {percent(region.standard)}, local {percent(local)}, combined {percent(combined)}")
    return 0


def build_parser()''')
    repo.after(c, "    rates.set_defaults(func=cmd_rates)\n", '''
    local = sub.add_parser("local", help="look up the local sales tax for a US ZIP code")
    local.add_argument("region", help="US state region, e.g. US-CA")
    local.add_argument("postcode", help="5-digit ZIP or ZIP+4 code")
    local.set_defaults(func=cmd_local)
''')
    sf = L("94103")
    repo.append("tests/test_cli.py", f'''

def test_local_rate_lookup(capsys):
    assert main(["local", "US-CA", "94103"]) == 0
    assert capsys.readouterr().out.strip() == "US-CA 94103: state 7.250%, local {pct(sf)}, combined {pct(Decimal("0.0725") + sf)}"


def test_local_outside_us_exits_2(capsys):
    assert main(["local", "DE", "10115"]) == 2
    assert "US regions only" in capsys.readouterr().err


def test_local_wrong_state_exits_2(capsys):
    assert main(["local", "US-WA", "94103"]) == 2
''')
    repo.commit("tomas", "2024-05-31T15:35:00Z", "feat(cli): add a local command to look up postcode rates")

    repo.write("CHANGELOG.md", changelog(27))
    repo.commit("amara", "2024-06-03T09:15:00Z", "docs: update the changelog for unreleased changes")

    m = "invoicer/money.py"
    repo.sub(m, '''def format_money(amount: object, currency: str) -> str:
    """Human readable amount, e.g. ``$1,234.50`` or ``-€3.00``."""
    value = round_money(amount, currency)
    sign = "-" if value < 0 else ""
    digits = f"{abs(value):,.{exponent(currency)}f}"
    return f"{sign}{CURRENCY_SYMBOLS.get(currency, currency + ' ')}{digits}"''', '''STYLES = ("symbol", "code", "plain")


def format_money(amount: object, currency: str, style: str = "symbol") -> str:
    """Human readable amount: ``$1,234.50``, ``USD 1,234.50`` or ``1234.50``."""
    if style not in STYLES:
        raise MoneyError(f"unknown amount style: {style}")
    value = round_money(amount, currency)
    if style == "plain":
        return f"{value:.{exponent(currency)}f}"
    sign = "-" if value < 0 else ""
    digits = f"{abs(value):,.{exponent(currency)}f}"
    prefix = f"{currency} " if style == "code" else CURRENCY_SYMBOLS.get(currency, currency + " ")
    return f"{sign}{prefix}{digits}"''')
    f = "invoicer/formatting.py"
    repo.resub(f, r"(def render_(text|markdown)\(invoice: Invoice, totals: Totals \| None = None)\)",
               r'\1, style: str = "symbol")', 2)
    repo.resub(f, r"format_money\(([^()]*), currency\)", r"format_money(\1, currency, style)", 10)
    c = "invoicer/cli.py"
    repo.sub(c, "from .money import format_money, percent", "from .money import STYLES, format_money, percent")
    repo.sub(c, "    sys.stdout.write(RENDERERS[args.format](_load(args.invoice, args.postcode)))\n", '''\
    invoice = _load(args.invoice, args.postcode)
    options = {"style": args.style} if args.format in ("text", "markdown") else {}
    sys.stdout.write(RENDERERS[args.format](invoice, **options))
''')
    repo.after(c, '    render.add_argument("--format", choices=sorted(RENDERERS), default="text")\n',
               '    render.add_argument("--style", choices=STYLES, default="symbol", help="how to write amounts")\n')
    repo.append("tests/test_money.py", '''

@pytest.mark.parametrize("style, expected", [("symbol", "-$1,234.50"), ("code", "-USD 1,234.50"), ("plain", "-1234.50")])
def test_format_money_styles(style, expected):
    assert format_money("-1234.5", "USD", style) == expected


def test_format_money_unknown_style():
    with pytest.raises(MoneyError):
        format_money("1", "USD", "fancy")
''')
    repo.append("tests/test_formatting.py", '''

def test_markdown_plain_amounts(make_invoice, item):
    md = render_markdown(make_invoice("GB", item("tea", "3.50", 2, category="food")), style="plain")
    assert "| **Total** | | **7.00** |" in md
''')
    repo.append("tests/test_cli.py", '''

def test_render_code_style(tmp_path, capsys):
    assert main(["render", write_invoice(tmp_path, INVOICE), "--style", "code"]) == 0
    assert capsys.readouterr().out.rstrip().endswith("USD 10.00")
''')
    repo.commit("sam", "2024-06-05T13:50:00Z", "feat(format): add a plain amount style for spreadsheets",
                "Pasting $1,234.50 into a spreadsheet gives text, not a number. --style plain writes 1234.50; --style code writes USD 1,234.50 for mixed-currency reports.")

    i = "invoicer/invoice.py"
    repo.after(i, "    tax: Decimal  # unrounded; the invoice rounds the sum once\n",
               '    rate: Decimal = Decimal("0")  # combined rate the line was taxed at\n')
    repo.sub(i, "from .rates import CATEGORIES, get_region", "from .rates import CATEGORIES, Region, get_region")
    repo.sub(i, "\n\ndef compute_totals(", '''

def _line_rate(region: Region, category: str, local: Decimal) -> Decimal:
    """State or national rate for ``category``, plus the local rate if it is taxed at all."""
    rate = region.rate_for(category)
    return rate + local if rate and local else rate


def compute_totals(''')
    repo.sub(i, '''        rate = region.rate_for(item.category)
        if rate and local:
            rate += local
        if region.inclusive:
            tax = line_tax(line_gross - share, rate, inclusive=True)
        else:
            tax = line_tax(line_gross - share, rate, inclusive=False)
        lines.append(LineTotals(item.sku, line_gross, share, tax))''', '''        rate = _line_rate(region, item.category, local)
        if region.inclusive:
            tax = line_tax(line_gross - share, rate, inclusive=True)
        else:
            tax = line_tax(line_gross, rate, inclusive=False)
        lines.append(LineTotals(item.sku, line_gross, share, tax, rate))''')
    repo.sub("invoicer/formatting.py", '"discount": str(line.discount)}', '"discount": str(line.discount), "rate": str(line.rate)}')
    repo.sub("tests/test_formatting.py", '"discount": "0"}]', '"discount": "0", "rate": "0"}]')
    repo.append("tests/test_invoice.py", f'''

def test_line_totals_keep_the_rate(make_invoice, item):
    totals = compute_totals(make_invoice("DE", item("book", "10.70", category="books"), item("lamp", "119.00")))
    assert [line.rate for line in totals.lines] == [D("0.07"), D("0.19")]


def test_line_rate_includes_local_tax(make_invoice, item):
    totals = compute_totals(make_invoice("US-WA", item("kettle", "50.00"), postcode="98101"))
    assert totals.lines[0].rate == D("{Decimal("0.065") + L("98101")}")


def test_exempt_line_rate_is_zero(make_invoice, item):
    totals = compute_totals(make_invoice("US-WA", item("gift-card", "25.00", category="exempt"), postcode="98101"))
    assert totals.lines[0].rate == D("0")
''')
    repo.commit("priya", "2024-06-07T16:25:00Z", "feat(invoice): keep each line's tax rate in the totals", """
        The json output and the upcoming per-line breakdown need the rate each
        line was taxed at. Work it out once per line in _line_rate() and keep
        it on LineTotals instead of recomputing it in every renderer.""")

    f = "invoicer/formatting.py"
    repo.sub(f, "from .money import format_money\n", "from .money import format_money, percent\n")
    repo.sub(f, 'def render_text(invoice: Invoice, totals: Totals | None = None, style: str = "symbol") -> str:',
             'def render_text(\n    invoice: Invoice, totals: Totals | None = None, style: str = "symbol", breakdown: bool = False\n) -> str:')
    repo.after(f, "        out.append(_row(label, format_money(line.gross, currency, style)))\n", '''\
        if breakdown:
            out.append(_row(f"    tax at {percent(line.rate)}", format_money(line.tax, currency, style)))
''')
    repo.append("tests/test_formatting.py", '''

def test_text_breakdown_shows_line_rates(make_invoice, item):
    invoice = make_invoice("DE", item("book", "10.70", category="books"), item("lamp", "119.00"))
    text = render_text(invoice, breakdown=True)
    assert "    tax at 7.000%" in text
    assert "    tax at 19.000%" in text
    assert all(len(line) <= 64 for line in text.splitlines())
''')
    repo.commit("tomas", "2024-06-10T10:40:00Z", "feat(format): show the tax rate on each line of text invoices")


ALLOCATION_TESTS = '''from decimal import Decimal as D

import pytest

from invoicer.discounts import allocate
from invoicer.money import quantum

# (currency, discount, line amounts), generated once and kept as data so a
# failure names the exact case.
CASES = [
{cases}
]


@pytest.mark.parametrize("currency, discount, lines", CASES)
def test_allocation_adds_up_and_stays_proportional(currency, discount, lines):
    amounts = [D(line) for line in lines]
    shares = allocate(D(discount), amounts, currency)
    assert sum(shares) == D(discount)
    total = sum(amounts)
    for share, amount in zip(shares, amounts):
        assert share >= 0
        assert abs(share - D(discount) * amount / total) < quantum(currency)
'''
EXAMPLE_INVOICES = {
    "us-wa-seattle": {
        "number": "INV-0001", "region": "US-WA", "postcode": "98101", "issued": "2024-06-03",
        "items": [{"sku": "kettle", "description": "Electric kettle", "quantity": 2, "unit_price": "50.00"},
                  {"sku": "coffee", "description": "Coffee beans 1kg", "quantity": 1, "unit_price": "18.40",
                   "category": "food"}],
        "coupon": {"code": "SAVE20", "kind": "percent", "value": "20"},
    },
    "de-bookshop": {
        "number": "RE-2024-118", "region": "DE", "issued": "2024-06-10", "terms_days": 14,
        "items": [{"sku": "atlas", "description": "World atlas", "quantity": 1, "unit_price": "39.00",
                   "category": "books"},
                  {"sku": "lamp", "description": "Desk lamp", "quantity": 2, "unit_price": "34.50"}],
        "coupon": {"code": "SOMMER5", "kind": "fixed", "value": "5.00"},
    },
    "ca-on-hardware": {
        "number": "ON-5521", "region": "CA-ON",
        "items": [{"sku": "drill", "description": "Cordless drill", "quantity": 1, "unit_price": "129.99"},
                  {"sku": "manual", "description": "Woodworking manual", "quantity": 1, "unit_price": "24.95",
                   "category": "books"}],
        "notes": "Thank you for your order.",
    },
    "jp-grocery": {
        "number": "JP-0042", "region": "JP",
        "items": [{"sku": "tea", "description": "Green tea", "quantity": 3, "unit_price": "1280", "category": "food"},
                  {"sku": "mug", "description": "Ceramic mug", "quantity": 2, "unit_price": "1650"}],
        "coupon": {"code": "TEN", "kind": "percent", "value": "10", "max_discount": "500"},
    },
}  # fmt: skip
EXAMPLE_TESTS = '''from pathlib import Path

import pytest

from invoicer.cli import main

EXAMPLES = sorted((Path(__file__).parent.parent / "examples").glob("*.json"))
COMMANDS = [
    ["total"],
    ["render"],
    ["render", "--format", "markdown"],
    ["render", "--format", "csv"],
    ["render", "--format", "json"],
    ["render", "--style", "plain"],
    ["render", "--breakdown"],
]


def test_examples_exist():
    assert len(EXAMPLES) == 4


@pytest.mark.parametrize("command", COMMANDS, ids=" ".join)
@pytest.mark.parametrize("example", EXAMPLES, ids=lambda path: path.stem)
def test_example(example, command, capsys):
    assert main([command[0], str(example), *command[1:]]) == 0
    assert capsys.readouterr().out.strip()
'''


def allocation_cases() -> str:
    rows = []
    for i in range(1, 41):
        currency = ("USD", "EUR", "JPY", "GBP")[h("alloc-cur", i) % 4]
        places = 0 if currency == "JPY" else 2
        unit = Decimal(1).scaleb(-places)
        lines = [Decimal(50 + h("alloc-line", i, j) % 20000).scaleb(-places) * (100 if places == 0 else 1)
                 for j in range(3 + h("alloc-n", i) % 6)]
        total = sum(lines)
        discount = (total * (1 + h("alloc-share", i) % 60) / 100).quantize(unit, rounding=ROUND_HALF_UP)
        rows.append(f'    ("{currency}", "{discount}", [{", ".join(f"{chr(34)}{x}{chr(34)}" for x in lines)}]),')
    return "\n".join(rows)


def part4(repo: Repo) -> None:
    c = "invoicer/cli.py"
    repo.after(c, '    options = {"style": args.style} if args.format in ("text", "markdown") else {}\n', '''\
    if args.breakdown:
        if args.format != "text":
            raise ValueError("--breakdown only works with --format text")
        options["breakdown"] = True
''')
    repo.after(c, 'help="how to write amounts")\n',
               '    render.add_argument("--breakdown", action="store_true", help="show the tax rate of every line")\n')
    rate = Decimal("0.065") + L("98101")
    repo.append("tests/test_cli.py", f'''

def test_render_breakdown(tmp_path, capsys):
    data = dict(INVOICE, region="US-WA", postcode="98101")
    assert main(["render", write_invoice(tmp_path, data), "--breakdown"]) == 0
    assert "    tax at {pct(rate)}" in capsys.readouterr().out


def test_breakdown_needs_text_format(tmp_path, capsys):
    assert main(["render", write_invoice(tmp_path, INVOICE), "--format", "csv", "--breakdown"]) == 2
    assert "--format text" in capsys.readouterr().err
''')
    repo.commit("sam", "2024-06-12T11:00:00Z", "feat(cli): add a breakdown flag to render",
                "Support can now show a customer which rate each line was taxed at.")

    d = "invoicer/discounts.py"
    repo.after(d, "    remainder = int((discount - sum(shares, Decimal(\"0\"))) / unit)\n",
               "    if remainder == 0:\n        return shares\n")
    repo.append("tests/test_discounts.py", '''

def test_allocate_even_split_needs_no_remainder():
    assert allocate(D("3.00"), [D("10.00"), D("10.00"), D("10.00")], "USD") == [D("1.00"), D("1.00"), D("1.00")]
''')
    repo.commit("amara", "2024-06-14T14:15:00Z", "perf(discounts): skip sorting when the shares already add up",
                "Most coupons split evenly to the cent; there is nothing to hand out in that case.")

    repo.write("tests/test_allocation.py", ALLOCATION_TESTS.replace("{cases}", allocation_cases()))
    repo.commit("priya", "2024-06-17T10:45:00Z", "test(discounts): cover allocation across many lines",
                "Forty invoices with three to eight lines in four currencies, including JPY with no minor unit.")

    repo.sub("pyproject.toml", 'test = ["pytest>=8"]', 'test = ["pytest>=8", "ruff>=0.4"]')
    repo.append("pyproject.toml", '\n[tool.ruff]\nline-length = 120\ntarget-version = "py311"\n')
    repo.commit("sam", "2024-06-19T16:30:00Z", "chore: add ruff to the test extras")

    repo.write("docs/cli.md", cli_md(35))
    repo.commit("tomas", "2024-06-21T09:50:00Z", "docs: document the breakdown flag and amount styles")

    for name, data in EXAMPLE_INVOICES.items():
        repo.write(f"examples/{name}.json", json.dumps(data, indent=2) + "\n")
    repo.write("tests/test_examples.py", EXAMPLE_TESTS)
    repo.after("README.md", "sales tax. See [docs/local-tax.md](docs/local-tax.md).\n",
               "\n[examples/](examples/) has a few more invoices to try the commands on.\n")
    repo.commit("amara", "2024-06-24T13:20:00Z", "test(cli): run every command against the example invoices")

    repo.write("CHANGELOG.md", changelog(37))
    repo.commit("priya", "2024-06-26T15:05:00Z", "docs: update the changelog for unreleased changes")

    repo.append(".gitignore", ".coverage\nhtmlcov/\n.ruff_cache/\n")
    repo.commit("sam", "2024-06-27T10:10:00Z", "chore: ignore coverage output")


# --- Generated documentation ------------------------------------------------------
def fixture_regions() -> dict[str, tuple[str, str, bool, Decimal, dict[str, Decimal]]]:
    out = {}
    pattern = r'_region\("([A-Z-]+)", "([^"]+)", "([A-Z]{3})", (True|False), "([\d.]+)"(.*)\)'
    for code, name, currency, inclusive, standard, rest in re.findall(pattern, fixed_fixture()["invoicer/rates.py"]):
        overrides = {k: Decimal(v) for k, v in re.findall(r'(\w+)="([\d.]+)"', rest)}
        out[code] = (name, currency, inclusive == "True", Decimal(standard), overrides)
    return out


def _row(label: str, amount: str) -> str:
    return f"{label}{amount:>{64 - len(label)}}"


def cli_md(stage: int) -> str:
    regions = fixture_regions()
    postcode = stage >= 16
    rate = Decimal("0.065") + (L("98101") if postcode else Decimal("0"))
    tax = money(Decimal("80.00") * rate)
    text = ["Invoice INV-0001 (US-WA)", "=" * 64, _row("2 x kettle", "$100.00")]
    if stage >= 35:
        text.append(_row(f"    tax at {pct(rate)}", f"${tax}"))
    text += ["-" * 64, _row("Subtotal", "$100.00"), _row("Discount SAVE20", "-$20.00"), _row("Tax", f"${tax}"),
             _row("Total", f"${Decimal('80.00') + tax}")]
    flags = " --postcode 98101" if postcode else ""
    flags += " --breakdown" if stage >= 35 else ""
    out = [
        "# Command line reference",
        "",
        "Run the commands with `python -m invoicer.cli`, or `invoicer` once the package",
        "is installed. Errors go to standard error as `invoicer: <message>` and the",
        "command exits with status 2.",
        "",
        "The examples below use the invoice from the README, saved as `invoice.json`:",
        "",
        "```json",
        "{",
        '  "number": "INV-0001",',
        '  "region": "US-WA",',
        '  "items": [{ "sku": "kettle", "quantity": 2, "unit_price": "50.00" }],',
        '  "coupon": { "code": "SAVE20", "kind": "percent", "value": "20" }',
        "}",
        "```",
        "",
        "## `total`",
        "",
        "Print the amount due, formatted for the invoice currency.",
        "",
        "    invoicer total INVOICE" + (" [--postcode ZIP]" if postcode else ""),
        "",
        "| Argument | Description |",
        "| --- | --- |",
        "| `INVOICE` | path to an invoice JSON file |",
    ]
    if postcode:
        out.append("| `--postcode ZIP` | US ZIP code for local sales tax; replaces the invoice's `postcode` |")
    out += ["", "```console", "$ invoicer total invoice.json", f"${Decimal('80.00') + money(Decimal('5.20'))}"]
    if postcode:
        out += ["$ invoicer total invoice.json --postcode 98101", f"${Decimal('80.00') + tax}"]
    out += ["```", "", "## `render`", "", "Render the whole invoice.", ""]
    usage = "    invoicer render INVOICE [--format FORMAT]"
    usage += " [--postcode ZIP]" if postcode else ""
    usage += " [--style STYLE] [--breakdown]" if stage >= 35 else ""
    out += [usage, "", "| Argument | Description |", "| --- | --- |", "| `INVOICE` | path to an invoice JSON file |",
            "| `--format FORMAT` | `text` (default), `markdown`, `csv` or `json` |"]
    if postcode:
        out.append("| `--postcode ZIP` | as for `total` |")
    if stage >= 35:
        out += ["| `--style STYLE` | `symbol` (default, `$1,234.50`), `code` (`USD 1,234.50`) or `plain` (`1234.50`); text and Markdown only |",
                "| `--breakdown` | show the rate and tax of every line; text only |"]
    out += [
        "",
        "Formats:",
        "",
        "- `text`: fixed width, 64 columns, for email bodies and receipts.",
        "- `markdown`: a GitHub-flavoured table for issues and wiki pages.",
        "- `csv`: one row per line item plus subtotal, discount, tax and total rows.",
        "  Amounts are plain decimals.",
        "- `json`: totals as strings, so no precision is lost.",
    ]
    if stage >= 35:
        out += [
            "  Each line has `sku`, `gross`, `discount` and `rate`.",
            "",
            "Text and Markdown invoices show the due date when the invoice has an `issued`",
            "date. Payment terms default to 30 days; set `terms_days` to change them.",
        ]
    out += ["", "```console", f"$ invoicer render invoice.json{flags}", *text, "```", "", "## `regions`", ""]
    out += ["    invoicer regions [--inclusive]" + (" [--country CODE]" if stage >= 35 else ""), ""]
    out += ["Lists every tax region: code, currency, whether tax is included (`incl`) or",
            "added (`excl`), the standard rate and the name. `--inclusive` keeps only",
            "regions that quote prices with tax included."]
    if stage >= 35:
        out += ["`--country` keeps only the regions of one country, for example `US` or `CA`."]
    out += ["", "```console", "$ invoicer regions" + (" --country CA" if stage >= 35 else "")]
    codes = [c for c in regions if c.startswith("CA-")] if stage >= 35 else ["US-CA", "US-WA", "CA-ON", "DE", "JP"]
    for code in codes:
        name, currency, inclusive, standard, _ = regions[code]
        out.append(f"{code:<6} {currency} {'incl' if inclusive else 'excl'} {pct(standard):>8}  {name}")
    if stage < 35:
        out.append("...")
    out.append("```")
    if stage >= 16:
        name, currency, inclusive, standard, overrides = regions["DE"]
        out += ["", "## `rates`", "", "    invoicer rates REGION", "",
                "Lists the rate for every product category in one region. Categories without",
                "their own rate use the standard rate; `exempt` is never taxed.", "",
                "```console", "$ invoicer rates DE", f"DE {name} ({currency}, tax included)"]
        for category in ("standard", "reduced", "food", "books", "digital", "exempt"):
            value = Decimal("0") if category == "exempt" else overrides.get(category, standard)
            out.append(f"  {category:<9} {pct(value):>8}")
        out.append("```")
    if stage >= 35:
        sf = L("94103")
        out += ["", "## `local`", "", "    invoicer local REGION ZIP", "",
                "Shows the state, local and combined sales tax for a US ZIP code. See",
                "[local-tax.md](local-tax.md) for how local rates work.", "",
                "```console", "$ invoicer local US-CA 94103",
                f"US-CA 94103: state 7.250%, local {pct(sf)}, combined {pct(Decimal('0.0725') + sf)}", "```"]
    out += ["", "## Exit status", "", "| Status | Meaning |", "| ---: | --- |", "| 0 | success |",
            "| 2 | bad arguments, unreadable file, unknown region or invalid invoice |", ""]
    return "\n".join(out)


def local_tax_md(groups: list[str]) -> str:
    regions = fixture_regions()
    sf = L("94103")
    mugs = Decimal("24.00") * (Decimal("0.0725") + sf)
    out = [
        "# Local sales tax",
        "",
        "US states charge sales tax at a state rate, and most counties and cities add",
        "their own rate on top. invoicer approximates the local part with one combined",
        "rate per three-digit ZIP prefix, kept in `invoicer/data/local_us.csv`:",
        "",
        "```csv",
        "prefix,region,rate",
        f"941,US-CA,{sf}",
        "```",
        "",
        "## Rules",
        "",
        "- Local tax applies only to US invoices with a `postcode`, or when `--postcode`",
        "  is passed on the command line.",
        "- The postcode must be a 5-digit ZIP or ZIP+4 code. Only the first three digits",
        "  are used.",
        "- A postcode from another state is an error, for example",
        "  `ZIP 94103 is in US-CA, not US-WA`.",
        "- Prefixes that are not in the table have no local tax.",
        "- The local rate is added to the state rate of every taxable line. Lines that",
        "  are zero-rated or exempt in the state stay untaxed.",
        "- Coupons apply before tax, exactly as for state tax, and tax is still rounded",
        "  once for the whole invoice.",
        "",
        "## Worked example",
        "",
        "An invoice for `US-CA` with postcode `94103`: two mugs at $12.00 and a loaf of",
        "bread at $4.00 (category `food`).",
        "",
        "| Line | Amount | Rate | Tax |",
        "| --- | ---: | ---: | ---: |",
        f"| 2 x mug | $24.00 | 7.250% + {pct(sf)} | {mugs} |",
        "| 1 x bread | $4.00 | 0% | 0 |",
        f"| **Invoice** | **$28.00** | | **${money(mugs)}** |",
        "",
        f"The total is ${Decimal('28.00') + money(mugs)}. Food is zero-rated in California, so the bread",
        "carries no local tax either.",
        "",
        "## Coverage",
        "",
        "| Region | State | Prefixes | Local rates |",
        "| --- | --- | ---: | --- |",
    ]
    for code in sorted(r for g in groups for r in GROUPS[g]):
        rates = [rate for owner, rate in LOCAL.values() if owner == code]
        out.append(f"| {code} | {regions[code][0]} | {len(rates)} | {pct(min(rates))} to {pct(max(rates))} |")
    out += ["", "Rates are illustrative and are not tax advice. Finance reviews every change to",
            "the table.", ""]
    return "\n".join(out)


def changelog(stage: int) -> str:
    added = [
        "- money: NZD, SGD, MXN and ZAR currencies",
        "- tax: New Zealand, Singapore, Mexico and South Africa",
        "- tax: local sales tax for US postcodes in 36 states, one combined rate per",
        "  three-digit ZIP prefix (`invoicer/data/local_us.csv`)",
        "- invoice: optional `postcode`, `issued` date and `terms_days` (default 30)",
        "- discounts: `max_discount` caps percent coupons",
        "- format: JSON renderer; text and Markdown invoices show the due date",
        "- cli: `--format json`, `--postcode`, `regions --country`, and the `rates`",
        "  and `local` commands",
    ]
    changed = [
        "- tax: region rates are read from `invoicer/data/regions.csv`; see the",
        "  generated table in `docs/regions.md`",
        "- tax: the postcode table is read on the first local lookup, not on import",
    ]
    if stage >= 37:
        added += [
            "- format: `plain` and `code` amount styles (`render --style`)",
            "- invoice: line totals keep the rate each line was taxed at; JSON lines",
            "  include it",
            "- cli: `render --breakdown` shows the rate and tax of every line",
            "- examples: four invoices to try the commands on",
        ]
        changed.append("- discounts: allocation returns early when the shares already add up")
    base = repo_changelog_base()
    return "# Changelog\n\n## Unreleased\n\n### Added\n\n" + "\n".join(added) + "\n\n### Changed\n\n" + \
        "\n".join(changed) + "\n\n" + base


def repo_changelog_base() -> str:
    return fixed_fixture()["CHANGELOG.md"].split("\n", 2)[2]


# --- Sanity checks ---------------------------------------------------------------
FORBIDDEN = re.compile(r"token-diet|copilot|\brtk\b|caveman|seeded|experiment", re.I)
REVEALING = re.compile(r"\b(fix|fixes|fixed|bug|bugs|seed|kit|regression|rounding error)\b", re.I)


def check(repo: Repo) -> None:
    if repo.git("status", "--porcelain"):
        raise SystemExit("history2: working tree is not clean")
    for rel, bug, fix in BUGS:
        head, released = repo.git("show", f"HEAD:{rel}"), repo.git("show", f"v0.9.0:{rel}")
        if bug not in head or fix in head or fix not in released or bug in released:
            raise SystemExit(f"history2: {rel} is not buggy at HEAD and correct at v0.9.0")
    subjects = repo.git("log", "--format=%s").splitlines()
    if bad := [s for s in subjects if not valid_subject(s)]:
        raise SystemExit(f"history2: bad subjects: {bad}")
    if (count := int(repo.git("rev-list", "--count", "v0.9.0..HEAD"))) != 38:
        raise SystemExit(f"history2: expected 38 commits after v0.9.0, found {count}")
    if REVEALING.search(repo.git("log", "--format=%B", "v0.9.0..HEAD")):
        raise SystemExit("history2: a later commit message gives the game away")
    if FORBIDDEN.search(repo.git("log", "-p", "--all", "--format=%an %ae%n%B")):
        raise SystemExit("history2: history mentions the test harness")


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    path = Path(sys.argv[1])
    if path.exists() and any(path.iterdir()):
        raise SystemExit(f"history2: {path} is not empty")
    path.mkdir(parents=True, exist_ok=True)
    repo = Repo(path)
    repo.git("init", "-q", "-b", "main")
    release(repo)
    for part in (part1, part2, part3, part4):
        part(repo)
    check(repo)


if __name__ == "__main__":
    main()
