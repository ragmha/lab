"""Acceptance test the agent never sees; run.sh adds it at verification time."""

from decimal import Decimal as D

import pytest

from invoicer import Coupon, Invoice, LineItem, compute_totals, round_money


def line(sku, price, quantity=1, category="standard"):
    return LineItem(sku, sku, quantity, D(price), category)


@pytest.mark.parametrize(
    "region, items, coupon, tax, total",
    [
        # coupons apply before tax
        ("US-CA", [line("a", "100.00"), line("b", "50.00", 2)], Coupon("P10", "percent", D("10")), "13.05", "193.05"),
        ("US-NY", [line("a", "30.00"), line("b", "20.00", category="food")], Coupon("F15", "fixed", D("15")), "0.84", "35.84"),
        ("CA-ON", [line("a", "9.99", 3)], Coupon("P25", "percent", D("25")), "2.92", "25.40"),
        ("DE", [line("a", "119.00")], Coupon("P10", "percent", D("10")), "17.10", "107.10"),
        # zero-rate categories stay untaxed
        ("US-CA", [line("bread", "10.00", category="food"), line("mug", "20.00")], None, "1.45", "31.45"),
        ("GB", [line("tea", "5.00", 2, category="food")], None, "0.00", "10.00"),
        # half a cent rounds up
        ("US-CA", [line("a", "10.00")], None, "0.73", "10.73"),
        ("US-OR", [line("a", "0.30")], Coupon("P15", "percent", D("15")), "0.00", "0.25"),
    ],
)
def test_totals(region, items, coupon, tax, total):
    totals = compute_totals(Invoice("HIDDEN", region, items, coupon))
    assert (totals.tax, totals.total) == (D(tax), D(total))


@pytest.mark.parametrize("value, currency, expected", [("2.5", "JPY", "3"), ("-0.125", "USD", "-0.13")])
def test_round_half_away_from_zero(value, currency, expected):
    assert round_money(value, currency) == D(expected)
