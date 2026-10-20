from decimal import Decimal as D

import pytest

from invoicer.rates import CATEGORIES, REGIONS, UnknownRegion, get_region, regions


def test_standard_rate_applies_without_override():
    assert get_region("US-CA").rate_for("digital") == D("0.0725")


def test_override_rate():
    assert get_region("DE").rate_for("books") == D("0.07")


@pytest.mark.parametrize("code, category", [("US-CA", "food"), ("CA-ON", "food"), ("GB", "books"), ("IE", "food")])
def test_zero_rate_override(code, category):
    assert get_region(code).rate_for(category) == D("0")


def test_exempt_is_always_zero():
    assert all(region.rate_for("exempt") == 0 for region in REGIONS.values())


def test_unknown_category():
    with pytest.raises(KeyError):
        get_region("US-CA").rate_for("luxury")


def test_get_region_is_case_insensitive():
    assert get_region("us-ny").name == "New York"


def test_unknown_region():
    with pytest.raises(UnknownRegion):
        get_region("XX")


def test_regions_filter():
    assert regions(inclusive=True) and all(region.inclusive for region in regions(inclusive=True))
    assert regions(inclusive=False) and not any(region.inclusive for region in regions(inclusive=False))


def test_rates_are_fractions():
    for region in REGIONS.values():
        for category in CATEGORIES:
            assert D("0") <= region.rate_for(category) < D("1"), (region.code, category)
