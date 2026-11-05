import json

from invoicer.cli import main


def write_invoice(tmp_path, data):
    path = tmp_path / "invoice.json"
    path.write_text(json.dumps(data), encoding="utf-8")
    return str(path)


INVOICE = {
    "number": "INV-1",
    "region": "US-OR",
    "items": [{"sku": "pen", "quantity": 4, "unit_price": "2.50"}],
}


def test_total(tmp_path, capsys):
    assert main(["total", write_invoice(tmp_path, INVOICE)]) == 0
    assert capsys.readouterr().out.strip() == "$10.00"


def test_render_markdown(tmp_path, capsys):
    assert main(["render", write_invoice(tmp_path, INVOICE), "--format", "markdown"]) == 0
    assert "### Invoice INV-1" in capsys.readouterr().out


def test_regions_inclusive_only(capsys):
    assert main(["regions", "--inclusive"]) == 0
    out = capsys.readouterr().out
    assert "Germany" in out
    assert "California" not in out


def test_unknown_region_exits_2(tmp_path, capsys):
    bad = dict(INVOICE, region="XX")
    assert main(["total", write_invoice(tmp_path, bad)]) == 2
    assert "invoicer:" in capsys.readouterr().err


def test_missing_file_exits_2(tmp_path, capsys):
    assert main(["total", str(tmp_path / "nope.json")]) == 2
