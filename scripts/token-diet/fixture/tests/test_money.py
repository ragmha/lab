from decimal import Decimal

import pytest

from invoicer.money import MoneyError, exponent, format_money, quantum, round_money, to_decimal


@pytest.mark.parametrize(
    "value, expected",
    [("1.005", "1.01"), ("1.004", "1.00"), ("2.675", "2.68"), ("-1.005", "-1.01"), ("0", "0.00")],
)
def test_round_money_half_up_usd(value, expected):
    assert round_money(value, "USD") == Decimal(expected)


def test_round_money_jpy_has_no_minor_unit():
    assert round_money("1234.5", "JPY") == Decimal("1235")


def test_quantum():
    assert quantum("USD") == Decimal("0.01")
    assert quantum("JPY") == Decimal("1")


def test_exponent_unknown_currency():
    with pytest.raises(MoneyError):
        exponent("XYZ")


def test_to_decimal_rejects_float():
    with pytest.raises(MoneyError):
        to_decimal(0.1)


def test_to_decimal_rejects_bool():
    with pytest.raises(MoneyError):
        to_decimal(True)


def test_to_decimal_rejects_garbage():
    with pytest.raises(MoneyError):
        to_decimal("ten dollars")


def test_to_decimal_accepts_int_and_str():
    assert to_decimal(3) == Decimal("3")
    assert to_decimal("3.10") == Decimal("3.10")


@pytest.mark.parametrize(
    "amount, currency, expected",
    [("1234.5", "USD", "$1,234.50"), ("-3", "EUR", "-€3.00"), ("1000", "JPY", "¥1,000"), ("9.99", "CHF", "CHF 9.99")],
)
def test_format_money(amount, currency, expected):
    assert format_money(amount, currency) == expected
