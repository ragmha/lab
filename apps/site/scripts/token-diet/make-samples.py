"""Generate fixture/tests/data/samples.json.

Expected totals come from a copy of the fixture with every bug in bugs.tsv
fixed, so the golden samples disagree with the buggy code exactly where the
bugs bite. Run with the kit's venv: .work/venv/bin/python make-samples.py
"""

import json
import random
import shutil
import sys
import tempfile
from decimal import Decimal
from pathlib import Path

KIT = Path(__file__).resolve().parent
FIXTURE = KIT / "fixture"
OUT = FIXTURE / "tests" / "data" / "samples.json"
BUGS = [line.split("\t") for line in (KIT / "bugs.tsv").read_text(encoding="utf-8").splitlines()]
COUNT, COUPON_RATE, SEED = 96, 0.3, 7
FIELDS = ("subtotal", "discount", "tax", "total")
SCALE = {"JPY": 150, "HUF": 350, "CZK": 23}
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


def load_fixed():
    tmp = Path(tempfile.mkdtemp())
    package = tmp / "invoicer_fixed"
    shutil.copytree(FIXTURE / "invoicer", package, ignore=shutil.ignore_patterns("__pycache__"))
    for path, bug, fix in BUGS:
        target = package / Path(path).relative_to("invoicer")
        source = target.read_text(encoding="utf-8")
        assert bug in source, f"seeded bug not found in {path}: {bug}"
        target.write_text(source.replace(bug, fix), encoding="utf-8")
    sys.path.insert(0, str(tmp))
    import invoicer_fixed

    return invoicer_fixed


def totals_of(package, invoice):
    totals = package.compute_totals(package.Invoice.from_dict(invoice))
    return {field: str(getattr(totals, field)) for field in FIELDS}


def main():
    fixed = load_fixed()
    sys.path.insert(0, str(FIXTURE))
    import invoicer as buggy

    round_money, REGIONS = fixed.round_money, fixed.rates.REGIONS

    rng = random.Random(SEED)
    codes = sorted(REGIONS)
    samples, failing = [], []
    for n in range(1, COUNT + 1):
        region = REGIONS[rng.choice(codes)]
        scale = SCALE.get(region.currency, 1)
        items = []
        for sku, description, category, base in rng.sample(CATALOG, rng.randint(1, 4)):
            price = Decimal(base) * scale * rng.randint(80, 120) / 100
            items.append(
                {
                    "sku": sku,
                    "description": description,
                    "quantity": rng.randint(1, 4),
                    "unit_price": str(round_money(price, region.currency)),
                    "category": category,
                }
            )
        invoice = {"number": f"INV-{n:04d}", "region": region.code, "items": items}
        if rng.random() < COUPON_RATE:
            if rng.random() < 0.5:
                value = rng.choice(["5", "10", "12.5", "15", "20", "25"])
                invoice["coupon"] = {"code": f"SAVE{value}", "kind": "percent", "value": value}
            else:
                value = str(rng.choice([2, 5, 10, 15]) * scale)
                invoice["coupon"] = {"code": f"MINUS{value}", "kind": "fixed", "value": value}
        expected = totals_of(fixed, invoice)
        if totals_of(buggy, invoice) != expected:
            failing.append(invoice["number"])
        samples.append({"invoice": invoice, "expected": expected})

    OUT.write_text(json.dumps(samples, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {len(samples)} samples; {len(failing)} fail under the seeded bugs: {' '.join(failing)}")


if __name__ == "__main__":
    main()
