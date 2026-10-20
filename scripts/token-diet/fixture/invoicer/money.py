"""Money helpers.

All amounts are ``decimal.Decimal``. Floats are rejected on purpose: binary
floating point cannot represent most cent values exactly, and an invoice has
to add up to the cent.
"""

from __future__ import annotations

from decimal import ROUND_HALF_EVEN, Decimal, InvalidOperation

# ISO 4217 minor units for the currencies we bill in.
CURRENCY_EXPONENTS: dict[str, int] = {
    "AUD": 2,
    "BGN": 2,
    "CAD": 2,
    "CHF": 2,
    "CZK": 2,
    "DKK": 2,
    "EUR": 2,
    "GBP": 2,
    "HUF": 2,
    "JPY": 0,
    "NOK": 2,
    "PLN": 2,
    "RON": 2,
    "SEK": 2,
    "USD": 2,
}

CURRENCY_SYMBOLS: dict[str, str] = {
    "AUD": "A$",
    "BGN": "лв ",
    "CAD": "C$",
    "CHF": "CHF ",
    "CZK": "Kč ",
    "DKK": "kr ",
    "EUR": "€",
    "GBP": "£",
    "HUF": "Ft ",
    "JPY": "¥",
    "NOK": "kr ",
    "PLN": "zł ",
    "RON": "lei ",
    "SEK": "kr ",
    "USD": "$",
}


class MoneyError(ValueError):
    """Raised for invalid amounts or unsupported currencies."""


def to_decimal(value: object) -> Decimal:
    """Convert ``value`` to ``Decimal`` without going through ``float``."""
    if isinstance(value, Decimal):
        return value
    if isinstance(value, bool):
        raise MoneyError(f"not an amount: {value!r}")
    if isinstance(value, float):
        raise MoneyError(f"use str or Decimal for money, not float: {value!r}")
    try:
        return Decimal(str(value))
    except InvalidOperation as exc:
        raise MoneyError(f"not an amount: {value!r}") from exc


def exponent(currency: str) -> int:
    """Number of minor-unit digits for ``currency`` (2 for USD, 0 for JPY)."""
    try:
        return CURRENCY_EXPONENTS[currency]
    except KeyError as exc:
        raise MoneyError(f"unsupported currency: {currency}") from exc


def quantum(currency: str) -> Decimal:
    """Smallest unit for ``currency``: ``Decimal('0.01')`` for USD."""
    return Decimal(1).scaleb(-exponent(currency))


def round_money(amount: object, currency: str) -> Decimal:
    """Round half up (away from zero) to the currency's minor unit."""
    return to_decimal(amount).quantize(quantum(currency), rounding=ROUND_HALF_EVEN)


def format_money(amount: object, currency: str) -> str:
    """Human readable amount, e.g. ``$1,234.50`` or ``-€3.00``."""
    value = round_money(amount, currency)
    sign = "-" if value < 0 else ""
    digits = f"{abs(value):,.{exponent(currency)}f}"
    return f"{sign}{CURRENCY_SYMBOLS.get(currency, currency + ' ')}{digits}"
