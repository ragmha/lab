import json
from decimal import Decimal
from pathlib import Path

import pytest

from invoicer import Invoice, compute_totals

SAMPLES = json.loads((Path(__file__).parent / "data" / "samples.json").read_text(encoding="utf-8"))
FIELDS = ("subtotal", "discount", "tax", "total")


@pytest.mark.parametrize("sample", SAMPLES, ids=[sample["invoice"]["number"] for sample in SAMPLES])
def test_sample_totals(sample):
    totals = compute_totals(Invoice.from_dict(sample["invoice"]))
    assert {field: getattr(totals, field) for field in FIELDS} == {
        field: Decimal(sample["expected"][field]) for field in FIELDS
    }
