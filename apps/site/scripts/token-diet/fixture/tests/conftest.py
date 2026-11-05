from decimal import Decimal

import pytest

from invoicer import Invoice, LineItem


@pytest.fixture
def item():
    def make(sku, price, quantity=1, category="standard"):
        return LineItem(sku=sku, description=sku.title(), quantity=quantity, unit_price=Decimal(price), category=category)

    return make


@pytest.fixture
def make_invoice():
    def make(region, *items, coupon=None, number="INV-TEST"):
        return Invoice(number=number, region=region, items=list(items), coupon=coupon)

    return make
