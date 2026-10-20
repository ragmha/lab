import csv
import io
from decimal import Decimal as D

from invoicer import Coupon
from invoicer.formatting import render_csv, render_markdown, render_text


def test_text_has_totals(make_invoice, item):
    text = render_text(make_invoice("US-CA", item("mug", "12.00", 2)))
    assert "Invoice INV-TEST (US-CA)" in text
    assert "Subtotal" in text
    assert text.rstrip().endswith("$25.74")


def test_text_shows_coupon_code(make_invoice, item):
    text = render_text(make_invoice("DE", item("lamp", "119.00"), coupon=Coupon("TEN", "percent", D("10"))))
    assert "Discount TEN" in text
    assert "-€11.90" in text
    assert "Tax included" in text


def test_text_lines_are_fixed_width(make_invoice, item):
    text = render_text(make_invoice("US-CA", item("a-very-long-product-name" * 3, "1.00")))
    assert all(len(line) <= 64 for line in text.splitlines())


def test_markdown_table(make_invoice, item):
    md = render_markdown(make_invoice("GB", item("tea", "3.50", 2, category="food")))
    assert "| Item | Qty | Amount |" in md
    assert "| **Total** | | **£7.00** |" in md


def test_csv_rows(make_invoice, item):
    rows = list(csv.reader(io.StringIO(render_csv(make_invoice("US-OR", item("pen", "2.50", 4))))))
    assert rows[0] == ["invoice", "sku", "description", "quantity", "amount", "currency"]
    assert rows[1] == ["INV-TEST", "pen", "Pen", "4", "10.00", "USD"]
    assert rows[-1] == ["INV-TEST", "", "total", "", "10.00", "USD"]
