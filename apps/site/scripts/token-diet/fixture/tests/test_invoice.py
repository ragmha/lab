from decimal import Decimal as D

import pytest

from invoicer import Coupon, Invoice, LineItem, compute_totals
from invoicer.invoice import InvoiceError, line_tax
from invoicer.rates import UnknownRegion


def test_subtotal_and_tax_without_coupon(make_invoice, item):
    totals = compute_totals(make_invoice("US-CA", item("mug", "12.00", 2), item("tee", "20.00")))
    assert totals.subtotal == D("44.00")
    assert totals.tax == D("3.19")
    assert totals.total == D("47.19")


def test_exempt_category_has_no_tax(make_invoice, item):
    totals = compute_totals(make_invoice("US-TX", item("gift-card", "50.00", category="exempt")))
    assert totals.tax == D("0")
    assert totals.total == D("50.00")


def test_food_override(make_invoice, item):
    totals = compute_totals(make_invoice("US-IL", item("bread", "4.00", 5, category="food")))
    assert totals.tax == D("0.20")


def test_inclusive_region_tax_is_contained_in_price(make_invoice, item):
    totals = compute_totals(make_invoice("DE", item("book", "10.70", category="books"), item("lamp", "119.00")))
    assert totals.subtotal == D("129.70")
    assert totals.total == D("129.70")
    assert totals.tax == D("19.70")


def test_inclusive_region_with_coupon(make_invoice, item):
    coupon = Coupon("TEN", "percent", D("10"))
    totals = compute_totals(make_invoice("DE", item("lamp", "119.00"), coupon=coupon))
    assert totals.discount == D("11.90")
    assert totals.total == D("107.10")
    assert totals.tax == D("17.10")


def test_percent_coupon_reduces_sales_tax(make_invoice, item):
    coupon = Coupon("SAVE20", "percent", D("20"))
    totals = compute_totals(make_invoice("US-WA", item("kettle", "50.00", 2), coupon=coupon))
    assert totals.subtotal == D("100.00")
    assert totals.discount == D("20.00")
    assert totals.tax == D("5.20")
    assert totals.total == D("85.20")


def test_fixed_coupon_reduces_sales_tax(make_invoice, item):
    coupon = Coupon("FIVE", "fixed", D("5.00"))
    totals = compute_totals(make_invoice("US-NY", item("cable", "15.00"), item("case", "10.00"), coupon=coupon))
    assert totals.tax == D("0.80")
    assert totals.total == D("20.80")


def test_line_tax_exclusive():
    assert line_tax(D("10.00"), D("0.10"), inclusive=False) == D("1.00")


def test_line_tax_inclusive():
    assert line_tax(D("11.00"), D("0.10"), inclusive=True) == D("1.00")


def test_empty_invoice_rejected(make_invoice):
    with pytest.raises(InvoiceError):
        compute_totals(make_invoice("US-CA"))


def test_unknown_region(make_invoice, item):
    with pytest.raises(UnknownRegion):
        compute_totals(make_invoice("XX", item("a", "1.00")))


@pytest.mark.parametrize("field, value", [("quantity", 0), ("unit_price", D("-1")), ("category", "luxury")])
def test_line_item_validation(field, value):
    data = {"sku": "a", "description": "A", "quantity": 1, "unit_price": D("1"), "category": "standard"}
    data[field] = value
    with pytest.raises(InvoiceError):
        LineItem(**data)


def test_round_trip_dict(make_invoice, item):
    invoice = make_invoice("GB", item("tea", "3.50", 4, category="food"), coupon=Coupon("T", "fixed", D("1")))
    assert Invoice.from_dict(invoice.to_dict()) == invoice


def test_jpy_totals_are_whole_yen(make_invoice, item):
    totals = compute_totals(make_invoice("JP", item("bento", "980", 3, category="food")))
    assert totals.total == D("2940")
    assert totals.tax == totals.tax.to_integral_value()
