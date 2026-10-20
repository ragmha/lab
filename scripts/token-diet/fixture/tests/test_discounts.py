from decimal import Decimal as D

import pytest

from invoicer.discounts import Coupon, CouponError, allocate, discount_amount


def test_percent_coupon():
    assert discount_amount(Coupon("TEN", "percent", D("10")), D("80.00"), "USD") == D("8.00")


def test_percent_coupon_rounds_half_up():
    assert discount_amount(Coupon("X", "percent", D("15")), D("0.30"), "USD") == D("0.05")


def test_fixed_coupon_capped_at_subtotal():
    assert discount_amount(Coupon("BIG", "fixed", D("50")), D("20.00"), "USD") == D("20.00")


def test_min_subtotal_not_met():
    coupon = Coupon("MIN", "fixed", D("5"), min_subtotal=D("100"))
    assert discount_amount(coupon, D("99.99"), "USD") == D("0")


def test_no_coupon():
    assert discount_amount(None, D("10"), "USD") == D("0")


@pytest.mark.parametrize("kind, value", [("bogus", "5"), ("percent", "0"), ("percent", "101"), ("fixed", "-1")])
def test_invalid_coupons(kind, value):
    with pytest.raises(CouponError):
        Coupon("BAD", kind, D(value))


def test_from_dict_defaults():
    coupon = Coupon.from_dict({"code": "SPRING", "kind": "percent", "value": "12.5"})
    assert coupon.min_subtotal == D("0")
    assert coupon.value == D("12.5")


def test_allocate_proportional():
    assert allocate(D("10.00"), [D("60.00"), D("40.00")], "USD") == [D("6.00"), D("4.00")]


def test_allocate_remainder_goes_to_largest_fraction():
    shares = allocate(D("0.10"), [D("1.00"), D("1.00"), D("1.00")], "USD")
    assert sum(shares) == D("0.10")
    assert shares == [D("0.04"), D("0.03"), D("0.03")]


def test_allocate_zero_discount():
    assert allocate(D("0"), [D("5"), D("5")], "USD") == [D("0"), D("0")]


def test_allocate_jpy_whole_units():
    shares = allocate(D("100"), [D("333"), D("333"), D("334")], "JPY")
    assert sum(shares) == D("100")
    assert shares == [D("33"), D("33"), D("34")]
