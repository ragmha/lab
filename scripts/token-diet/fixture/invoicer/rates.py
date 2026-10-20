"""Regional tax rates.

Illustrative rates for development and tests only. They are not tax advice
and are not kept in sync with any jurisdiction.

``inclusive`` regions quote prices with tax already included (VAT/GST style):
the customer pays the shelf price and the invoice shows the tax contained in
it. Every other region adds tax on top of the net price (US sales tax style).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal

CATEGORIES = ("standard", "reduced", "food", "books", "digital", "exempt")


class UnknownRegion(KeyError):
    """Raised when an invoice names a region we do not have rates for."""


@dataclass(frozen=True)
class Region:
    code: str
    name: str
    currency: str
    inclusive: bool
    standard: Decimal
    overrides: dict[str, Decimal] = field(default_factory=dict)

    def rate_for(self, category: str) -> Decimal:
        """Tax rate for a product category, as a fraction (0.19 for 19%)."""
        if category not in CATEGORIES:
            raise KeyError(f"unknown tax category: {category}")
        if category == "exempt":
            return Decimal("0")
        return self.overrides.get(category) or self.standard


def _region(code: str, name: str, currency: str, inclusive: bool, standard: str, **overrides: str) -> Region:
    return Region(
        code=code,
        name=name,
        currency=currency,
        inclusive=inclusive,
        standard=Decimal(standard),
        overrides={category: Decimal(rate) for category, rate in overrides.items()},
    )


REGIONS: dict[str, Region] = {
    region.code: region
    for region in (
        # --- United States: state sales tax, added on top of the price ------
        _region("US-AL", "Alabama", "USD", False, "0.04", food="0.03"),
        _region("US-AK", "Alaska", "USD", False, "0"),
        _region("US-AZ", "Arizona", "USD", False, "0.056", food="0"),
        _region("US-AR", "Arkansas", "USD", False, "0.065", food="0.00125"),
        _region("US-CA", "California", "USD", False, "0.0725", food="0"),
        _region("US-CO", "Colorado", "USD", False, "0.029", food="0"),
        _region("US-CT", "Connecticut", "USD", False, "0.0635", food="0", digital="0.01"),
        _region("US-DE", "Delaware", "USD", False, "0"),
        _region("US-DC", "District of Columbia", "USD", False, "0.06", food="0"),
        _region("US-FL", "Florida", "USD", False, "0.06", food="0"),
        _region("US-GA", "Georgia", "USD", False, "0.04", food="0"),
        _region("US-HI", "Hawaii", "USD", False, "0.04"),
        _region("US-ID", "Idaho", "USD", False, "0.06"),
        _region("US-IL", "Illinois", "USD", False, "0.0625", food="0.01"),
        _region("US-IN", "Indiana", "USD", False, "0.07", food="0"),
        _region("US-IA", "Iowa", "USD", False, "0.06", food="0"),
        _region("US-KS", "Kansas", "USD", False, "0.065", food="0"),
        _region("US-KY", "Kentucky", "USD", False, "0.06", food="0"),
        _region("US-LA", "Louisiana", "USD", False, "0.05", food="0"),
        _region("US-ME", "Maine", "USD", False, "0.055", food="0"),
        _region("US-MD", "Maryland", "USD", False, "0.06", food="0"),
        _region("US-MA", "Massachusetts", "USD", False, "0.0625", food="0"),
        _region("US-MI", "Michigan", "USD", False, "0.06", food="0"),
        _region("US-MN", "Minnesota", "USD", False, "0.06875", food="0"),
        _region("US-MS", "Mississippi", "USD", False, "0.07", food="0.05"),
        _region("US-MO", "Missouri", "USD", False, "0.04225", food="0.01225"),
        _region("US-MT", "Montana", "USD", False, "0"),
        _region("US-NE", "Nebraska", "USD", False, "0.055", food="0"),
        _region("US-NV", "Nevada", "USD", False, "0.0685", food="0"),
        _region("US-NH", "New Hampshire", "USD", False, "0"),
        _region("US-NJ", "New Jersey", "USD", False, "0.06625", food="0"),
        _region("US-NM", "New Mexico", "USD", False, "0.04875", food="0"),
        _region("US-NY", "New York", "USD", False, "0.04", food="0"),
        _region("US-NC", "North Carolina", "USD", False, "0.0475", food="0"),
        _region("US-ND", "North Dakota", "USD", False, "0.05", food="0"),
        _region("US-OH", "Ohio", "USD", False, "0.0575", food="0"),
        _region("US-OK", "Oklahoma", "USD", False, "0.045", food="0"),
        _region("US-OR", "Oregon", "USD", False, "0"),
        _region("US-PA", "Pennsylvania", "USD", False, "0.06", food="0"),
        _region("US-RI", "Rhode Island", "USD", False, "0.07", food="0"),
        _region("US-SC", "South Carolina", "USD", False, "0.06", food="0"),
        _region("US-SD", "South Dakota", "USD", False, "0.042"),
        _region("US-TN", "Tennessee", "USD", False, "0.07", food="0.04"),
        _region("US-TX", "Texas", "USD", False, "0.0625", food="0"),
        _region("US-UT", "Utah", "USD", False, "0.061", food="0.03"),
        _region("US-VT", "Vermont", "USD", False, "0.06", food="0"),
        _region("US-VA", "Virginia", "USD", False, "0.053", food="0.01"),
        _region("US-WA", "Washington", "USD", False, "0.065", food="0"),
        _region("US-WV", "West Virginia", "USD", False, "0.06", food="0"),
        _region("US-WI", "Wisconsin", "USD", False, "0.05", food="0"),
        _region("US-WY", "Wyoming", "USD", False, "0.04", food="0"),
        # --- Canada: GST/HST, added on top of the price ----------------------
        _region("CA-AB", "Alberta", "CAD", False, "0.05", food="0"),
        _region("CA-BC", "British Columbia", "CAD", False, "0.12", food="0", books="0.05"),
        _region("CA-MB", "Manitoba", "CAD", False, "0.12", food="0"),
        _region("CA-NB", "New Brunswick", "CAD", False, "0.15", food="0"),
        _region("CA-NL", "Newfoundland and Labrador", "CAD", False, "0.15", food="0"),
        _region("CA-NS", "Nova Scotia", "CAD", False, "0.14", food="0"),
        _region("CA-ON", "Ontario", "CAD", False, "0.13", food="0", books="0.05"),
        _region("CA-PE", "Prince Edward Island", "CAD", False, "0.15", food="0"),
        _region("CA-QC", "Quebec", "CAD", False, "0.14975", food="0"),
        _region("CA-SK", "Saskatchewan", "CAD", False, "0.11", food="0"),
        # --- European Union: VAT, included in the shelf price ----------------
        _region("AT", "Austria", "EUR", True, "0.20", reduced="0.10", food="0.10", books="0.10"),
        _region("BE", "Belgium", "EUR", True, "0.21", reduced="0.06", food="0.06", books="0.06"),
        _region("BG", "Bulgaria", "BGN", True, "0.20", reduced="0.09", books="0.09"),
        _region("HR", "Croatia", "EUR", True, "0.25", reduced="0.13", food="0.05", books="0.05"),
        _region("CY", "Cyprus", "EUR", True, "0.19", reduced="0.09", food="0.05", books="0.05"),
        _region("CZ", "Czechia", "CZK", True, "0.21", reduced="0.12", food="0.12", books="0"),
        _region("DK", "Denmark", "DKK", True, "0.25"),
        _region("EE", "Estonia", "EUR", True, "0.24", reduced="0.09", books="0.09"),
        _region("FI", "Finland", "EUR", True, "0.255", reduced="0.14", food="0.14", books="0.10"),
        _region("FR", "France", "EUR", True, "0.20", reduced="0.10", food="0.055", books="0.055"),
        _region("DE", "Germany", "EUR", True, "0.19", reduced="0.07", food="0.07", books="0.07"),
        _region("GR", "Greece", "EUR", True, "0.24", reduced="0.13", food="0.13", books="0.06"),
        _region("HU", "Hungary", "HUF", True, "0.27", reduced="0.18", food="0.18", books="0.05"),
        _region("IE", "Ireland", "EUR", True, "0.23", reduced="0.135", food="0", books="0"),
        _region("IT", "Italy", "EUR", True, "0.22", reduced="0.10", food="0.04", books="0.04"),
        _region("LV", "Latvia", "EUR", True, "0.21", reduced="0.12", books="0.05"),
        _region("LT", "Lithuania", "EUR", True, "0.21", reduced="0.09", books="0.09"),
        _region("LU", "Luxembourg", "EUR", True, "0.17", reduced="0.08", food="0.03", books="0.03"),
        _region("MT", "Malta", "EUR", True, "0.18", reduced="0.07", food="0", books="0.05"),
        _region("NL", "Netherlands", "EUR", True, "0.21", reduced="0.09", food="0.09", books="0.09"),
        _region("PL", "Poland", "PLN", True, "0.23", reduced="0.08", food="0.05", books="0.05"),
        _region("PT", "Portugal", "EUR", True, "0.23", reduced="0.13", food="0.06", books="0.06"),
        _region("RO", "Romania", "RON", True, "0.21", reduced="0.11", food="0.11", books="0.11"),
        _region("SK", "Slovakia", "EUR", True, "0.23", reduced="0.19", food="0.19", books="0.05"),
        _region("SI", "Slovenia", "EUR", True, "0.22", reduced="0.095", food="0.095", books="0.05"),
        _region("ES", "Spain", "EUR", True, "0.21", reduced="0.10", food="0.04", books="0.04"),
        _region("SE", "Sweden", "SEK", True, "0.25", reduced="0.12", food="0.12", books="0.06"),
        # --- Rest of the world: VAT/GST, included in the shelf price ---------
        _region("GB", "United Kingdom", "GBP", True, "0.20", food="0", books="0"),
        _region("NO", "Norway", "NOK", True, "0.25", food="0.15"),
        _region("CH", "Switzerland", "CHF", True, "0.081", reduced="0.026", food="0.026", books="0.026"),
        _region("JP", "Japan", "JPY", True, "0.10", food="0.08"),
        _region("AU", "Australia", "AUD", True, "0.10", food="0"),
    )
}


def get_region(code: str) -> Region:
    try:
        return REGIONS[code.upper()]
    except KeyError:
        raise UnknownRegion(code) from None


def regions(*, inclusive: bool | None = None) -> list[Region]:
    """All regions, optionally only tax-inclusive or tax-exclusive ones."""
    return [region for region in REGIONS.values() if inclusive is None or region.inclusive == inclusive]
