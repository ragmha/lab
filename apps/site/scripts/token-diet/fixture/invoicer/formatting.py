"""Render invoices for people and spreadsheets."""

from __future__ import annotations

import csv
import io

from .invoice import Invoice, Totals, compute_totals
from .money import format_money
from .rates import get_region

WIDTH = 64


def _row(label: str, amount: str, width: int = WIDTH) -> str:
    return f"{label}{amount:>{width - len(label)}}"


def _tax_label(invoice: Invoice) -> str:
    return "Tax included" if get_region(invoice.region).inclusive else "Tax"


def render_text(invoice: Invoice, totals: Totals | None = None) -> str:
    """Fixed-width plain text, suitable for email bodies and receipts."""
    totals = totals or compute_totals(invoice)
    currency = totals.currency
    out = [f"Invoice {invoice.number} ({invoice.region})", "=" * WIDTH]
    for item, line in zip(invoice.items, totals.lines):
        label = f"{item.quantity} x {item.description}"[: WIDTH - 16]
        out.append(_row(label, format_money(line.gross, currency)))
    out.append("-" * WIDTH)
    out.append(_row("Subtotal", format_money(totals.subtotal, currency)))
    if totals.discount:
        code = invoice.coupon.code if invoice.coupon else ""
        out.append(_row(f"Discount {code}".rstrip(), "-" + format_money(totals.discount, currency)))
    out.append(_row(_tax_label(invoice), format_money(totals.tax, currency)))
    out.append(_row("Total", format_money(totals.total, currency)))
    if invoice.notes:
        out += ["", invoice.notes]
    return "\n".join(out) + "\n"


def render_markdown(invoice: Invoice, totals: Totals | None = None) -> str:
    """GitHub-flavoured Markdown table."""
    totals = totals or compute_totals(invoice)
    currency = totals.currency
    out = [
        f"### Invoice {invoice.number}",
        "",
        "| Item | Qty | Amount |",
        "| --- | ---: | ---: |",
    ]
    for item, line in zip(invoice.items, totals.lines):
        out.append(f"| {item.description} | {item.quantity} | {format_money(line.gross, currency)} |")
    out.append(f"| **Subtotal** | | {format_money(totals.subtotal, currency)} |")
    if totals.discount:
        out.append(f"| Discount | | -{format_money(totals.discount, currency)} |")
    out.append(f"| {_tax_label(invoice)} | | {format_money(totals.tax, currency)} |")
    out.append(f"| **Total** | | **{format_money(totals.total, currency)}** |")
    return "\n".join(out) + "\n"


def render_csv(invoice: Invoice, totals: Totals | None = None) -> str:
    """One row per line item plus summary rows; amounts are plain decimals."""
    totals = totals or compute_totals(invoice)
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(["invoice", "sku", "description", "quantity", "amount", "currency"])
    for item, line in zip(invoice.items, totals.lines):
        writer.writerow([invoice.number, item.sku, item.description, item.quantity, line.gross, totals.currency])
    for label in ("subtotal", "discount", "tax", "total"):
        writer.writerow([invoice.number, "", label, "", getattr(totals, label), totals.currency])
    return buffer.getvalue()
