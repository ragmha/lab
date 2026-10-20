# Changelog

## 0.9.0 (2024-04-02)

First public release.

- money: decimal money helpers with half-up rounding
- tax: sales tax, GST/HST and VAT rates for US states, Canadian provinces,
  the EU and a few other countries
- discounts: percent and fixed coupons, split across lines by largest
  remainder
- invoice: coupons apply per line, before tax
- format: text, Markdown and CSV renderers
- cli: `total`, `render` and `regions` commands
