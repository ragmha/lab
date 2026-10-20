"""Coupons and discount allocation."""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from .money import quantum, round_money, to_decimal

KINDS = ("percent", "fixed")


class CouponError(ValueError):
    """Raised for coupons that can never be applied."""


@dataclass(frozen=True)
class Coupon:
    code: str
    kind: str
    value: Decimal
    min_subtotal: Decimal = Decimal("0")

    def __post_init__(self) -> None:
        if self.kind not in KINDS:
            raise CouponError(f"unknown coupon kind: {self.kind}")
        if self.value <= 0:
            raise CouponError("coupon value must be positive")
        if self.kind == "percent" and self.value > 100:
            raise CouponError("percent coupons cannot exceed 100")

    @classmethod
    def from_dict(cls, data: dict) -> Coupon:
        return cls(
            code=data["code"],
            kind=data["kind"],
            value=to_decimal(data["value"]),
            min_subtotal=to_decimal(data.get("min_subtotal", "0")),
        )

    def to_dict(self) -> dict:
        return {
            "code": self.code,
            "kind": self.kind,
            "value": str(self.value),
            "min_subtotal": str(self.min_subtotal),
        }


def discount_amount(coupon: Coupon | None, subtotal: Decimal, currency: str) -> Decimal:
    """Discount for ``subtotal``; never more than the subtotal itself."""
    if coupon is None or subtotal < coupon.min_subtotal:
        return Decimal("0")
    if coupon.kind == "percent":
        amount = subtotal * coupon.value / Decimal(100)
    else:
        amount = coupon.value
    return round_money(min(amount, subtotal), currency)


def allocate(discount: Decimal, line_totals: list[Decimal], currency: str) -> list[Decimal]:
    """Split ``discount`` across lines in proportion to their totals.

    Uses the largest-remainder method, so the shares always add up to
    ``discount`` exactly, to the currency's minor unit.
    """
    total = sum(line_totals, Decimal("0"))
    if discount == 0 or total == 0:
        return [Decimal("0") for _ in line_totals]
    unit = quantum(currency)
    raw = [discount * line / total for line in line_totals]
    shares = [(share // unit) * unit for share in raw]
    remainder = int((discount - sum(shares, Decimal("0"))) / unit)
    order = sorted(range(len(raw)), key=lambda i: (raw[i] - shares[i], -i), reverse=True)
    for i in order[:remainder]:
        shares[i] += unit
    return shares
