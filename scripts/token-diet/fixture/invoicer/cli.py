"""Command line entry point: ``python -m invoicer.cli``."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .formatting import render_csv, render_markdown, render_text
from .invoice import Invoice, compute_totals
from .money import format_money
from .rates import UnknownRegion, regions

RENDERERS = {"text": render_text, "markdown": render_markdown, "csv": render_csv}


def _load(path: str) -> Invoice:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    return Invoice.from_dict(data)


def cmd_total(args: argparse.Namespace) -> int:
    totals = compute_totals(_load(args.invoice))
    print(format_money(totals.total, totals.currency))
    return 0


def cmd_render(args: argparse.Namespace) -> int:
    sys.stdout.write(RENDERERS[args.format](_load(args.invoice)))
    return 0


def cmd_regions(args: argparse.Namespace) -> int:
    for region in regions(inclusive=args.inclusive):
        kind = "incl" if region.inclusive else "excl"
        print(f"{region.code:<6} {region.currency} {kind} {region.standard * 100:>7.3f}%  {region.name}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="invoicer", description="Total and render invoices.")
    sub = parser.add_subparsers(dest="command", required=True)

    total = sub.add_parser("total", help="print the amount due")
    total.add_argument("invoice", help="path to an invoice JSON file")
    total.set_defaults(func=cmd_total)

    render = sub.add_parser("render", help="render an invoice")
    render.add_argument("invoice", help="path to an invoice JSON file")
    render.add_argument("--format", choices=sorted(RENDERERS), default="text")
    render.set_defaults(func=cmd_render)

    listing = sub.add_parser("regions", help="list tax regions")
    listing.add_argument("--inclusive", action="store_true", default=None, help="only tax-inclusive regions")
    listing.set_defaults(func=cmd_regions)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return args.func(args)
    except (OSError, UnknownRegion, ValueError) as exc:
        print(f"invoicer: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
