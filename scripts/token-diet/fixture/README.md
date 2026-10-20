# invoicer

A small library and CLI that totals invoices: line items, coupons, regional
tax (US sales tax, Canadian GST/HST, VAT) and currency rounding.

## Usage

```sh
python -m invoicer.cli total invoice.json
python -m invoicer.cli render invoice.json --format markdown
python -m invoicer.cli regions --inclusive
```

An invoice file looks like this:

```json
{
  "number": "INV-0001",
  "region": "US-WA",
  "items": [{ "sku": "kettle", "quantity": 2, "unit_price": "50.00" }],
  "coupon": { "code": "SAVE20", "kind": "percent", "value": "20" }
}
```

## Development

```sh
python -m pytest
```

`tests/data/samples.json` holds golden invoices checked by the finance team.
See [CONTRIBUTING.md](CONTRIBUTING.md) before you commit.
