"""Invoices and their totals."""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal

from .discounts import Coupon, allocate, discount_amount
from .money import round_money, to_decimal
from .rates import CATEGORIES, get_region


class InvoiceError(ValueError):
    """Raised for invoices that cannot be totalled."""


@dataclass(frozen=True)
class LineItem:
    sku: str
    description: str
    quantity: int
    unit_price: Decimal
    category: str = "standard"

    def __post_init__(self) -> None:
        if self.quantity <= 0:
            raise InvoiceError(f"{self.sku}: quantity must be positive")
        if self.unit_price < 0:
            raise InvoiceError(f"{self.sku}: unit price cannot be negative")
        if self.category not in CATEGORIES:
            raise InvoiceError(f"{self.sku}: unknown category {self.category}")

    @classmethod
    def from_dict(cls, data: dict) -> LineItem:
        return cls(
            sku=data["sku"],
            description=data.get("description", data["sku"]),
            quantity=int(data["quantity"]),
            unit_price=to_decimal(data["unit_price"]),
            category=data.get("category", "standard"),
        )

    def to_dict(self) -> dict:
        return {
            "sku": self.sku,
            "description": self.description,
            "quantity": self.quantity,
            "unit_price": str(self.unit_price),
            "category": self.category,
        }


@dataclass(frozen=True)
class LineTotals:
    sku: str
    gross: Decimal  # quantity * unit price, rounded to the currency
    discount: Decimal  # this line's share of the coupon
    tax: Decimal  # unrounded; the invoice rounds the sum once


@dataclass(frozen=True)
class Totals:
    currency: str
    subtotal: Decimal
    discount: Decimal
    tax: Decimal
    total: Decimal
    lines: tuple[LineTotals, ...] = ()


@dataclass
class Invoice:
    number: str
    region: str
    items: list[LineItem] = field(default_factory=list)
    coupon: Coupon | None = None
    notes: str = ""

    def add(self, item: LineItem) -> None:
        self.items.append(item)

    @classmethod
    def from_dict(cls, data: dict) -> Invoice:
        coupon = data.get("coupon")
        return cls(
            number=data["number"],
            region=data["region"],
            items=[LineItem.from_dict(item) for item in data.get("items", [])],
            coupon=Coupon.from_dict(coupon) if coupon else None,
            notes=data.get("notes", ""),
        )

    def to_dict(self) -> dict:
        data: dict = {
            "number": self.number,
            "region": self.region,
            "items": [item.to_dict() for item in self.items],
        }
        if self.coupon:
            data["coupon"] = self.coupon.to_dict()
        if self.notes:
            data["notes"] = self.notes
        return data


def line_tax(net: Decimal, rate: Decimal, inclusive: bool) -> Decimal:
    """Tax for one line, unrounded.

    ``net`` is what the customer pays for the line after discounts. In
    inclusive regions the tax is already contained in that amount.
    """
    if inclusive:
        return net - net / (1 + rate)
    return net * rate


def compute_totals(invoice: Invoice) -> Totals:
    """Subtotal, discount, tax and amount due for ``invoice``.

    Line amounts are rounded to the currency first, the coupon is split
    across lines, and the tax is rounded once for the whole invoice.
    """
    if not invoice.items:
        raise InvoiceError(f"{invoice.number}: invoice has no items")
    region = get_region(invoice.region)
    currency = region.currency

    gross = [round_money(item.unit_price * item.quantity, currency) for item in invoice.items]
    subtotal = sum(gross, Decimal("0"))
    discount = discount_amount(invoice.coupon, subtotal, currency)
    shares = allocate(discount, gross, currency)

    lines = []
    for item, line_gross, share in zip(invoice.items, gross, shares):
        rate = region.rate_for(item.category)
        if region.inclusive:
            tax = line_tax(line_gross - share, rate, inclusive=True)
        else:
            tax = line_tax(line_gross, rate, inclusive=False)
        lines.append(LineTotals(item.sku, line_gross, share, tax))

    tax = round_money(sum((line.tax for line in lines), Decimal("0")), currency)
    total = subtotal - discount if region.inclusive else subtotal - discount + tax
    return Totals(currency, subtotal, discount, tax, total, tuple(lines))
