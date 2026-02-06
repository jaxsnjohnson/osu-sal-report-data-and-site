#!/usr/bin/env python3
"""Build a standalone HTML report for workers impacted by the Workday change."""

from __future__ import annotations

import argparse
import json
import math
import re
import unicodedata
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
from zipfile import ZipFile

SPREADSHEET_NS = {"a": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}

DEFAULT_WORKBOOK = Path(__file__).parent / "SEIU Workday RFI Sections 1 and 3 - Feb 5 2026.xlsx"
DEFAULT_INDEX = Path(__file__).parent.parent / "data" / "index.json"
DEFAULT_OUTPUT = Path(__file__).parent / "impacted-workers-report.html"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workbook", type=Path, default=DEFAULT_WORKBOOK)
    parser.add_argument("--index", type=Path, default=DEFAULT_INDEX)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    return parser.parse_args()


def normalize_name(value: str) -> str:
    raw = (value or "").replace("’", "'").replace("`", "'").strip()
    raw = unicodedata.normalize("NFKD", raw).encode("ascii", "ignore").decode("ascii")
    raw = raw.lower().replace("'", "")
    return re.sub(r"[^a-z0-9]+", "", raw)


def parse_float(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def excel_serial_to_date_string(value: str) -> str:
    number = parse_float(value)
    if number is None:
        return str(value or "")
    base = datetime(1899, 12, 30)
    date_obj = base + timedelta(days=number)
    return date_obj.strftime("%Y-%m-%d")


def parse_shared_strings(archive: ZipFile) -> list[str]:
    if "xl/sharedStrings.xml" not in archive.namelist():
        return []

    root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
    shared_strings: list[str] = []

    for si in root.findall("a:si", SPREADSHEET_NS):
        parts: list[str] = []
        text_node = si.find("a:t", SPREADSHEET_NS)
        if text_node is not None and text_node.text:
            parts.append(text_node.text)
        for run in si.findall("a:r", SPREADSHEET_NS):
            run_text = run.find("a:t", SPREADSHEET_NS)
            if run_text is not None and run_text.text:
                parts.append(run_text.text)
        shared_strings.append("".join(parts))

    return shared_strings


def cell_text(cell: ET.Element, shared_strings: list[str]) -> str:
    cell_type = cell.attrib.get("t", "")
    value_node = cell.find("a:v", SPREADSHEET_NS)

    if cell_type == "s":
        if value_node is None or not value_node.text:
            return ""
        index = int(value_node.text)
        return shared_strings[index] if index < len(shared_strings) else ""

    if cell_type == "inlineStr":
        inline_text = cell.find("a:is/a:t", SPREADSHEET_NS)
        return inline_text.text if inline_text is not None and inline_text.text else ""

    if value_node is None or value_node.text is None:
        return ""
    return value_node.text


def read_workbook_rows(workbook_path: Path) -> list[dict[str, str]]:
    with ZipFile(workbook_path) as archive:
        shared_strings = parse_shared_strings(archive)
        worksheet = ET.fromstring(archive.read("xl/worksheets/sheet1.xml"))

    header: dict[str, str] = {}
    rows: list[dict[str, str]] = []

    for row_index, row_node in enumerate(
        worksheet.findall(".//a:sheetData/a:row", SPREADSHEET_NS), start=1
    ):
        by_column: dict[str, str] = {}
        for cell in row_node.findall("a:c", SPREADSHEET_NS):
            reference = cell.attrib.get("r", "")
            column_match = re.match(r"([A-Z]+)", reference)
            if not column_match:
                continue
            by_column[column_match.group(1)] = cell_text(cell, shared_strings).strip()

        if row_index == 1:
            header = {column: name for column, name in by_column.items() if name}
            continue

        if not header:
            continue

        record: dict[str, str] = {name: by_column.get(column, "") for column, name in header.items()}
        if any(record.values()):
            rows.append(record)

    return rows


def parse_iso_date_to_ordinal(value: str) -> int:
    try:
        return datetime.strptime(value, "%Y-%m-%d").toordinal()
    except ValueError:
        return 0


def parse_last_job(entry: dict[str, Any]) -> dict[str, Any]:
    last_job = entry.get("_lastJob")
    if isinstance(last_job, dict):
        return last_job
    return {}


def select_best_candidate(candidates: list[dict[str, Any]], target_key: str) -> dict[str, Any]:
    def ranking(candidate: dict[str, Any]) -> tuple[int, int, float, int]:
        entry = candidate["entry"]
        last_date = parse_iso_date_to_ordinal(str(entry.get("_lastDate", "")))
        last_job = parse_last_job(entry)
        pay = parse_float(entry.get("_totalPay"))
        if pay is None:
            pay = parse_float(last_job.get("Annual Salary Rate")) or 0.0
        key_distance = -abs(len(candidate["normalized"]) - len(target_key))
        has_timeline = 1 if entry.get("_hasTimeline") else 0
        return (has_timeline, last_date, pay, key_distance)

    return max(candidates, key=ranking)


def build_index_lookup(index_path: Path) -> tuple[dict[str, list[dict[str, Any]]], list[str]]:
    raw_index = json.loads(index_path.read_text())
    lookup: dict[str, list[dict[str, Any]]] = defaultdict(list)

    for canonical_name, entry in raw_index.items():
        normalized = normalize_name(canonical_name)
        lookup[normalized].append(
            {
                "canonical_name": canonical_name,
                "normalized": normalized,
                "entry": entry,
            }
        )

    keys = list(lookup.keys())
    return lookup, keys


def find_name_match(
    target_name: str,
    lookup: dict[str, list[dict[str, Any]]],
    lookup_keys: list[str],
) -> tuple[dict[str, Any] | None, str]:
    target_key = normalize_name(target_name)
    if not target_key:
        return None, "missing"

    direct = lookup.get(target_key, [])
    if direct:
        return select_best_candidate(direct, target_key), "exact"

    prefix_candidates: list[dict[str, Any]] = []
    for key in lookup_keys:
        if key.startswith(target_key) or target_key.startswith(key):
            prefix_candidates.extend(lookup[key])

    if prefix_candidates:
        return select_best_candidate(prefix_candidates, target_key), "prefix"

    return None, "missing"


def quantile(values: list[float], percentile: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    position = (len(ordered) - 1) * percentile
    low = math.floor(position)
    high = math.ceil(position)
    if low == high:
        return ordered[int(position)]
    weight = position - low
    return ordered[low] + (ordered[high] - ordered[low]) * weight


def build_workers(
    workbook_rows: list[dict[str, str]],
    lookup: dict[str, list[dict[str, Any]]],
    lookup_keys: list[str],
) -> list[dict[str, Any]]:
    workers: list[dict[str, Any]] = []

    for row in workbook_rows:
        raw_name = row.get("LFM Name", "").strip()
        match, match_type = find_name_match(raw_name, lookup, lookup_keys)

        worker: dict[str, Any] = {
            "name": raw_name,
            "inputName": raw_name,
            "workPhone": row.get("Work Phone", ""),
            "hireDate": excel_serial_to_date_string(row.get("Hire Date", "")),
            "apptStatus": row.get("Appt Status", ""),
            "fte": parse_float(row.get("FTE", "")),
            "supervisor": row.get("Supervisor Name", ""),
            "department": "",
            "jobTitle": "",
            "salaryTerm": "",
            "annualSalary": None,
            "weeklyPay": None,
            "matchType": match_type,
            "isUnclassified": None,
        }

        if match:
            entry = match["entry"]
            canonical_name = match["canonical_name"]
            last_job = parse_last_job(entry)
            meta = entry.get("Meta") if isinstance(entry.get("Meta"), dict) else {}
            annual_salary = parse_float(entry.get("_totalPay"))
            if annual_salary is None:
                annual_salary = parse_float(last_job.get("Annual Salary Rate"))

            worker.update(
                {
                    "name": canonical_name,
                    "department": str(last_job.get("Job Orgn") or meta.get("Home Orgn") or ""),
                    "jobTitle": str(last_job.get("Job Title") or ""),
                    "salaryTerm": str(last_job.get("Salary Term") or ""),
                    "annualSalary": annual_salary,
                    "weeklyPay": annual_salary / 52.0 if annual_salary is not None else None,
                    "isUnclassified": bool(entry.get("_isUnclass"))
                    if entry.get("_isUnclass") is not None
                    else None,
                }
            )

        workers.append(worker)

    return workers


def build_summary(workers: list[dict[str, Any]]) -> dict[str, Any]:
    weekly = [w["weeklyPay"] for w in workers if isinstance(w.get("weeklyPay"), (int, float))]
    annual = [w["annualSalary"] for w in workers if isinstance(w.get("annualSalary"), (int, float))]
    matches = len(weekly)
    total = len(workers)
    p25 = quantile(weekly, 0.25)
    p50 = quantile(weekly, 0.50)
    p80 = quantile(weekly, 0.80)
    p90 = quantile(weekly, 0.90)

    def count_at_or_above(threshold: float | None) -> int:
        if threshold is None:
            return 0
        return sum(1 for value in weekly if value >= threshold)

    return {
        "totalImpactedWorkers": total,
        "salaryMatches": matches,
        "unmatchedWorkers": total - matches,
        "percentMatched": (matches / total * 100.0) if total else 0.0,
        "weeklyPay25thPercentile": p25,
        "weeklyPayMedian": p50,
        "weeklyPay80thPercentile": p80,
        "weeklyPay90thPercentile": p90,
        "weeklyPay25thCountOrAbove": count_at_or_above(p25),
        "weeklyPayMedianCountOrAbove": count_at_or_above(p50),
        "weeklyPay80thCountOrAbove": count_at_or_above(p80),
        "weeklyPay90thCountOrAbove": count_at_or_above(p90),
        "weeklyPayAverage": (sum(weekly) / len(weekly)) if weekly else None,
        "annualPayAverage": (sum(annual) / len(annual)) if annual else None,
        "annualPayTotal": sum(annual) if annual else None,
    }


def breakdown_department(workers: list[dict[str, Any]]) -> list[dict[str, Any]]:
    bucket: dict[str, dict[str, Any]] = defaultdict(
        lambda: {"department": "", "count": 0, "annualTotal": 0.0, "weeklyTotal": 0.0}
    )
    for worker in workers:
        annual = worker.get("annualSalary")
        weekly = worker.get("weeklyPay")
        if not isinstance(annual, (int, float)) or not isinstance(weekly, (int, float)):
            continue
        department = (worker.get("department") or "Unknown").strip() or "Unknown"
        row = bucket[department]
        row["department"] = department
        row["count"] += 1
        row["annualTotal"] += annual
        row["weeklyTotal"] += weekly

    output = []
    for value in bucket.values():
        output.append(
            {
                "department": value["department"],
                "count": value["count"],
                "averageAnnualSalary": value["annualTotal"] / value["count"],
                "averageWeeklyPay": value["weeklyTotal"] / value["count"],
            }
        )
    output.sort(key=lambda row: (-row["count"], -row["averageAnnualSalary"], row["department"]))
    return output


def breakdown_supervisor(workers: list[dict[str, Any]]) -> list[dict[str, Any]]:
    bucket: dict[str, dict[str, Any]] = defaultdict(
        lambda: {"label": "", "count": 0, "weeklyTotal": 0.0, "weeklyCount": 0}
    )
    for worker in workers:
        label = (worker.get("supervisor") or "Unknown Supervisor").strip() or "Unknown Supervisor"
        row = bucket[label]
        row["label"] = label
        row["count"] += 1
        weekly = worker.get("weeklyPay")
        if isinstance(weekly, (int, float)):
            row["weeklyTotal"] += weekly
            row["weeklyCount"] += 1

    output: list[dict[str, Any]] = []
    for row in bucket.values():
        avg_weekly = row["weeklyTotal"] / row["weeklyCount"] if row["weeklyCount"] else None
        output.append({"label": row["label"], "count": row["count"], "averageWeeklyPay": avg_weekly})
    output.sort(key=lambda row: (-row["count"], -(row["averageWeeklyPay"] or 0.0), row["label"]))
    return output


def breakdown_job_title(workers: list[dict[str, Any]]) -> list[dict[str, Any]]:
    bucket: dict[str, dict[str, Any]] = defaultdict(
        lambda: {"label": "", "count": 0, "weeklyTotal": 0.0, "weeklyCount": 0}
    )
    for worker in workers:
        label = (worker.get("jobTitle") or "Unknown Role").strip() or "Unknown Role"
        row = bucket[label]
        row["label"] = label
        row["count"] += 1
        weekly = worker.get("weeklyPay")
        if isinstance(weekly, (int, float)):
            row["weeklyTotal"] += weekly
            row["weeklyCount"] += 1

    output: list[dict[str, Any]] = []
    for row in bucket.values():
        avg_weekly = row["weeklyTotal"] / row["weeklyCount"] if row["weeklyCount"] else None
        output.append({"label": row["label"], "count": row["count"], "averageWeeklyPay": avg_weekly})
    output.sort(key=lambda row: (-row["count"], -(row["averageWeeklyPay"] or 0.0), row["label"]))
    return output


def breakdown_salary_bands(workers: list[dict[str, Any]]) -> list[dict[str, Any]]:
    def label_for(weekly_pay: float | None) -> str:
        if weekly_pay is None:
            return "Missing Salary"
        if weekly_pay < 1000:
            return "< $1,000"
        if weekly_pay < 1500:
            return "$1,000-$1,499"
        if weekly_pay < 2000:
            return "$1,500-$1,999"
        return "$2,000+"

    counter = Counter(label_for(worker.get("weeklyPay")) for worker in workers)
    weekly_totals: dict[str, float] = defaultdict(float)
    for worker in workers:
        label = label_for(worker.get("weeklyPay"))
        weekly = worker.get("weeklyPay")
        if isinstance(weekly, (int, float)):
            weekly_totals[label] += weekly

    order = ["< $1,000", "$1,000-$1,499", "$1,500-$1,999", "$2,000+", "Missing Salary"]
    output = []
    for label in order:
        if label not in counter:
            continue
        output.append(
            {
                "label": label,
                "count": counter.get(label, 0),
                "weeklyPayrollTotal": weekly_totals.get(label, 0.0),
            }
        )
    return output


def build_payload(
    workbook_path: Path,
    workbook_rows: list[dict[str, str]],
    workers: list[dict[str, Any]],
) -> dict[str, Any]:
    summary = build_summary(workers)
    unmatched = [worker["inputName"] for worker in workers if worker.get("weeklyPay") is None]
    payload = {
        "generatedAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "sourceWorkbook": workbook_path.name,
        "rowCount": len(workbook_rows),
        "summary": summary,
        "departmentBreakdown": breakdown_department(workers),
        "supervisorBreakdown": breakdown_supervisor(workers),
        "roleBreakdown": breakdown_job_title(workers),
        "salaryBandBreakdown": breakdown_salary_bands(workers),
        "unmatchedNames": unmatched,
        "workers": workers,
    }
    return payload


def html_template(data_json: str) -> str:
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Impacted Worker Compensation Report</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    :root {{
      --primary: #D73F09;
      --primary-soft: rgba(215, 63, 9, 0.15);
      --bg-body: #1a1a1a;
      --bg-card: #2c2c2c;
      --bg-card-soft: #262626;
      --text-main: #f1f1f1;
      --text-muted: #a0a0a0;
      --border: #444444;
      --success: #2eaea2;
      --warn: #fbbf24;
    }}
    * {{
      box-sizing: border-box;
    }}
    body {{
      margin: 0;
      color: var(--text-main);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: var(--bg-body);
      min-height: 100vh;
    }}
    .layout {{
      max-width: 1400px;
      width: 100%;
      margin: 0 auto;
      padding: 26px 18px 34px;
    }}
    .hero {{
      background:
        radial-gradient(900px 250px at -12% -40%, rgba(215, 63, 9, 0.25), transparent 55%),
        radial-gradient(680px 240px at 115% -35%, rgba(46, 174, 162, 0.20), transparent 58%),
        var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 24px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.32);
      animation: fade-in 500ms ease-out;
    }}
    h1 {{
      margin: 0 0 8px;
      font-size: clamp(1.5rem, 3vw, 2.3rem);
      letter-spacing: 0.01em;
      color: var(--text-main);
      text-wrap: balance;
    }}
    .subtitle {{
      margin: 0;
      color: var(--text-muted);
      font-size: 0.98rem;
    }}
    .kpis {{
      margin-top: 18px;
      display: grid;
      gap: 12px;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    }}
    .kpi {{
      background: linear-gradient(180deg, #2a2a2a, #242424);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 14px;
      animation: rise-up 450ms ease both;
      transition: transform 0.2s ease, border-color 0.2s ease;
    }}
    .kpi:hover {{
      transform: translateY(-1px);
      border-color: #5a5a5a;
    }}
    .kpi:nth-child(2) {{ animation-delay: 40ms; }}
    .kpi:nth-child(3) {{ animation-delay: 80ms; }}
    .kpi:nth-child(4) {{ animation-delay: 120ms; }}
    .kpi-label {{
      font-size: 0.78rem;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      color: var(--text-muted);
    }}
    .kpi-value {{
      margin-top: 6px;
      font-weight: 700;
      font-size: 1.35rem;
      color: var(--text-main);
    }}
    .explain {{
      margin: 14px 0 0;
      color: var(--text-muted);
      font-size: 0.9rem;
    }}
    .grid {{
      margin-top: 18px;
      display: grid;
      gap: 14px;
      grid-template-columns: repeat(auto-fit, minmax(290px, 1fr));
    }}
    .charts-grid {{
      margin-top: 14px;
    }}
    .panel {{
      background: linear-gradient(180deg, var(--bg-card), var(--bg-card-soft));
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 16px;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.24);
      animation: fade-in 480ms ease-out;
      transition: border-color 0.2s ease, box-shadow 0.2s ease;
    }}
    .panel:hover {{
      border-color: #565656;
      box-shadow: 0 6px 18px rgba(0, 0, 0, 0.28);
    }}
    .panel h2 {{
      margin: 0 0 8px;
      font-size: 1.05rem;
      color: var(--text-main);
    }}
    .panel-full {{
      grid-column: 1 / -1;
    }}
    .band-layout {{
      display: grid;
      gap: 12px;
      grid-template-columns: 1.1fr 1fr 1.1fr;
      align-items: start;
    }}
    .band-col {{
      min-width: 0;
    }}
    .chart-wrap {{
      position: relative;
      height: 280px;
      margin-top: 8px;
    }}
    .chart-note {{
      margin: 4px 0 0;
      font-size: 0.8rem;
      color: var(--text-muted);
    }}
    .chart-error {{
      height: 280px;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 1px dashed var(--border);
      border-radius: 10px;
      color: var(--warn);
      font-size: 0.9rem;
    }}
    .bar-list {{
      margin: 0;
      padding: 0;
      list-style: none;
      display: grid;
      gap: 7px;
    }}
    .scroll-list {{
      max-height: 230px;
      overflow-y: auto;
      padding-right: 6px;
      scrollbar-width: thin;
      scrollbar-color: #666 #2a2a2a;
    }}
    .scroll-list::-webkit-scrollbar {{
      width: 10px;
    }}
    .scroll-list::-webkit-scrollbar-track {{
      background: #2a2a2a;
      border-radius: 999px;
    }}
    .scroll-list::-webkit-scrollbar-thumb {{
      background: #666;
      border-radius: 999px;
      border: 2px solid #2a2a2a;
    }}
    .scroll-list::-webkit-scrollbar-thumb:hover {{
      background: #777;
    }}
    .bar-row {{
      display: grid;
      gap: 6px;
      grid-template-columns: 1fr auto;
      align-items: center;
      font-size: 0.88rem;
      padding: 4px 0;
    }}
    .subheading {{
      margin: 0 0 6px;
      color: var(--text-muted);
      font-size: 0.78rem;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }}
    .marker-grid {{
      display: grid;
      gap: 8px;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    }}
    .marker {{
      border: 1px solid var(--border);
      background: #242424;
      border-radius: 10px;
      padding: 8px 10px;
    }}
    .marker-label {{
      color: var(--text-muted);
      font-size: 0.74rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }}
    .marker-value {{
      margin-top: 3px;
      font-size: 0.96rem;
      font-weight: 700;
    }}
    .marker-meta {{
      margin-top: 2px;
      color: var(--text-muted);
      font-size: 0.76rem;
    }}
    .bar-label {{
      color: var(--text-muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 100%;
    }}
    .bar-value {{
      font-variant-numeric: tabular-nums;
      font-weight: 600;
    }}
    .bar-track {{
      grid-column: 1 / -1;
      height: 9px;
      border-radius: 999px;
      background: #444;
      overflow: hidden;
    }}
    .bar-fill {{
      height: 100%;
      border-radius: 999px;
      background: linear-gradient(90deg, var(--primary), var(--success));
      width: 0%;
      transition: width 420ms ease;
    }}
    .controls {{
      margin-top: 18px;
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      align-items: center;
    }}
    .search {{
      flex: 1;
      min-width: 240px;
    }}
    input[type="search"] {{
      width: 100%;
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 11px 12px;
      font-size: 0.95rem;
      color: var(--text-main);
      background: #333;
      transition: border-color 0.2s ease, box-shadow 0.2s ease;
    }}
    input[type="search"]:focus {{
      outline: none;
      border-color: var(--primary);
      box-shadow: 0 0 0 3px var(--primary-soft);
    }}
    .pill {{
      background: #333;
      border: 1px solid var(--border);
      color: var(--text-muted);
      border-radius: 999px;
      padding: 5px 10px;
      font-size: 0.82rem;
    }}
    .table-wrap {{
      margin-top: 10px;
      border: 1px solid var(--border);
      border-radius: 14px;
      overflow: auto;
      background: #222;
      box-shadow: 0 5px 18px rgba(0, 0, 0, 0.25);
    }}
    table {{
      width: 100%;
      min-width: 1100px;
      border-collapse: collapse;
      font-size: 0.86rem;
    }}
    thead th {{
      position: sticky;
      top: 0;
      z-index: 1;
      text-align: left;
      background: #333;
      padding: 9px;
      border-bottom: 1px solid var(--border);
      color: var(--text-main);
      white-space: nowrap;
      cursor: pointer;
      user-select: none;
      transition: background 0.15s ease;
    }}
    thead th:hover {{
      background: #3a3a3a;
    }}
    tbody td {{
      border-bottom: 1px solid #3a3a3a;
      padding: 8px 9px;
      white-space: nowrap;
    }}
    tbody tr:hover {{
      background: #303030;
    }}
    tbody tr:nth-child(even) {{
      background: rgba(255, 255, 255, 0.01);
    }}
    .num {{
      text-align: right;
      font-variant-numeric: tabular-nums;
    }}
    .missing {{
      color: var(--warn);
      font-style: italic;
    }}
    .footnote {{
      margin-top: 10px;
      color: var(--text-muted);
      font-size: 0.82rem;
    }}
    .unmatched-list {{
      margin-top: 8px;
      color: var(--warn);
      font-size: 0.86rem;
      line-height: 1.45;
    }}
    @keyframes fade-in {{
      from {{ opacity: 0; transform: translateY(5px); }}
      to {{ opacity: 1; transform: translateY(0); }}
    }}
    @keyframes rise-up {{
      from {{ opacity: 0; transform: translateY(12px); }}
      to {{ opacity: 1; transform: translateY(0); }}
    }}
    @media (max-width: 1200px) {{
      .band-layout {{
        grid-template-columns: 1fr 1fr;
      }}
    }}
    @media (max-width: 900px) {{
      .band-layout {{
        grid-template-columns: 1fr;
      }}
    }}
    @media (max-width: 760px) {{
      .layout {{
        padding: 14px 12px 20px;
      }}
      .hero, .panel {{
        border-radius: 12px;
      }}
    }}
  </style>
</head>
<body>
  <main class="layout">
    <section class="hero">
      <h1>Impacted Worker Compensation Report</h1>
      <p class="subtitle" id="subtitle"></p>
      <div class="kpis">
        <article class="kpi">
          <div class="kpi-label">Impacted Workers</div>
          <div class="kpi-value" id="kpiTotal">-</div>
        </article>
        <article class="kpi">
          <div class="kpi-label">Salary Matched</div>
          <div class="kpi-value" id="kpiMatches">-</div>
        </article>
        <article class="kpi">
          <div class="kpi-label">80th Percentile Weekly Pay</div>
          <div class="kpi-value" id="kpiP80">-</div>
        </article>
        <article class="kpi">
          <div class="kpi-label">Median Weekly Pay</div>
          <div class="kpi-value" id="kpiMedian">-</div>
        </article>
      </div>
      <p class="explain">Weekly pay is calculated as annual salary rate divided by 52 weeks.</p>
    </section>

    <section class="grid">
      <article class="panel">
        <h2>Department Breakdown (Top 15 by Count)</h2>
        <ul class="bar-list scroll-list" id="deptBreakdown"></ul>
      </article>
      <article class="panel">
        <h2>Top Supervisors (Impacted Count)</h2>
        <ul class="bar-list scroll-list" id="supervisorBreakdown"></ul>
      </article>
      <article class="panel">
        <h2>Top Job Titles (Impacted Count)</h2>
        <ul class="bar-list scroll-list" id="roleBreakdown"></ul>
      </article>
      <article class="panel panel-full">
        <h2>Weekly Pay Bands</h2>
        <div class="band-layout">
          <div class="band-col">
            <div class="subheading">Band Counts</div>
            <ul class="bar-list" id="bandBreakdown"></ul>
          </div>
          <div class="band-col">
            <div class="subheading">Percentile Markers</div>
            <div class="marker-grid" id="percentileMarkers"></div>
          </div>
          <div class="band-col">
            <div class="subheading">Weekly Payroll by Band</div>
            <ul class="bar-list" id="bandPayrollBreakdown"></ul>
          </div>
        </div>
      </article>
    </section>

    <section class="grid charts-grid">
      <article class="panel">
        <h2>Salary Band Share (Pie)</h2>
        <div class="chart-wrap">
          <canvas id="salaryBandChart"></canvas>
        </div>
      </article>
      <article class="panel">
        <h2>Top Departments (Bar)</h2>
        <div class="chart-wrap">
          <canvas id="departmentChart"></canvas>
        </div>
      </article>
      <article class="panel">
        <h2>Top Supervisors (Horizontal Bar)</h2>
        <div class="chart-wrap">
          <canvas id="supervisorChart"></canvas>
        </div>
      </article>
      <article class="panel">
        <h2>Weekly Pay Distribution</h2>
        <div class="chart-wrap">
          <canvas id="weeklyPayChart"></canvas>
        </div>
        <p class="chart-note">Binned from matched annual salary records converted to weekly pay.</p>
      </article>
    </section>

    <section class="panel">
      <h2>Impacted Worker Details</h2>
      <div class="controls">
        <label class="search">
          <input type="search" id="searchInput" placeholder="Search name, department, title, supervisor, email...">
        </label>
        <span class="pill" id="visibleCount">0 shown</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th data-sort="name">Name</th>
              <th data-sort="department">Department</th>
              <th data-sort="jobTitle">Job Title</th>
              <th class="num" data-sort="annualSalary">Annual Salary</th>
              <th class="num" data-sort="weeklyPay">Weekly Pay</th>
              <th data-sort="apptStatus">Appt Status</th>
              <th class="num" data-sort="fte">FTE</th>
              <th data-sort="hireDate">Hire Date</th>
              <th data-sort="supervisor">Supervisor</th>
            </tr>
          </thead>
          <tbody id="workerTableBody"></tbody>
        </table>
      </div>
      <div class="footnote">
        Source workbook: <span id="sourceWorkbook"></span> | Generated: <span id="generatedAt"></span>.
      </div>
      <div class="unmatched-list" id="unmatchedList"></div>
    </section>
  </main>

  <script>
    const REPORT_DATA = {data_json};

    const esc = (value) => String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

    const asCurrency = (value) => {{
      if (typeof value !== "number" || Number.isNaN(value)) return "Missing";
      return value.toLocaleString(undefined, {{ style: "currency", currency: "USD", maximumFractionDigits: 2 }});
    }};

    const asNumber = (value, digits = 0) => {{
      if (typeof value !== "number" || Number.isNaN(value)) return "Missing";
      return value.toLocaleString(undefined, {{ minimumFractionDigits: digits, maximumFractionDigits: digits }});
    }};

    const compareValues = (a, b, key, direction) => {{
      const va = a[key];
      const vb = b[key];
      const dir = direction === "asc" ? 1 : -1;
      if (typeof va === "number" && typeof vb === "number") {{
        return (va - vb) * dir;
      }}
      const sa = (va ?? "").toString().toLowerCase();
      const sb = (vb ?? "").toString().toLowerCase();
      if (sa < sb) return -1 * dir;
      if (sa > sb) return 1 * dir;
      return 0;
    }};

    const renderBarList = (elementId, rows, labelKey = "label", valueKey = "count", maxRows = rows.length) => {{
      const target = document.getElementById(elementId);
      target.innerHTML = "";
      const sliced = rows.slice(0, maxRows);
      if (sliced.length === 0) {{
        target.innerHTML = '<li class="bar-row"><span class="bar-label">No data</span></li>';
        return;
      }}
      const maxValue = Math.max(...sliced.map((row) => row[valueKey]), 1);
      for (const row of sliced) {{
        const li = document.createElement("li");
        li.className = "bar-row";
        const percent = (row[valueKey] / maxValue) * 100;
        li.innerHTML = `
          <span class="bar-label" title="${{esc(row[labelKey])}}">${{esc(row[labelKey])}}</span>
          <span class="bar-value">${{asNumber(row[valueKey])}}</span>
          <span class="bar-track"><span class="bar-fill" style="width:${{percent}}%"></span></span>
        `;
        target.appendChild(li);
      }}
    }};

    const renderCountAndAverageList = (elementId, rows, maxRows = rows.length) => {{
      const target = document.getElementById(elementId);
      target.innerHTML = "";
      const sliced = rows.slice(0, maxRows);
      if (sliced.length === 0) {{
        target.innerHTML = '<li class="bar-row"><span class="bar-label">No data</span></li>';
        return;
      }}
      const maxCount = Math.max(...sliced.map((row) => row.count), 1);
      for (const row of sliced) {{
        const li = document.createElement("li");
        li.className = "bar-row";
        const percent = (row.count / maxCount) * 100;
        li.innerHTML = `
          <span class="bar-label" title="${{esc(row.label)}}">${{esc(row.label)}}</span>
          <span class="bar-value">${{asNumber(row.count)}} workers · ${{asCurrency(row.averageWeeklyPay)}} avg/wk</span>
          <span class="bar-track"><span class="bar-fill" style="width:${{percent}}%"></span></span>
        `;
        target.appendChild(li);
      }}
    }};

    const renderPayrollByBand = (elementId, rows) => {{
      const target = document.getElementById(elementId);
      target.innerHTML = "";
      const withTotals = rows.filter((row) => typeof row.weeklyPayrollTotal === "number");
      if (withTotals.length === 0) {{
        target.innerHTML = '<li class="bar-row"><span class="bar-label">No payroll data</span></li>';
        return;
      }}
      const maxTotal = Math.max(...withTotals.map((row) => row.weeklyPayrollTotal), 1);
      for (const row of withTotals) {{
        const li = document.createElement("li");
        li.className = "bar-row";
        const percent = (row.weeklyPayrollTotal / maxTotal) * 100;
        li.innerHTML = `
          <span class="bar-label" title="${{esc(row.label)}}">${{esc(row.label)}}</span>
          <span class="bar-value">${{asCurrency(row.weeklyPayrollTotal)}}</span>
          <span class="bar-track"><span class="bar-fill" style="width:${{percent}}%"></span></span>
        `;
        target.appendChild(li);
      }}
    }};

    const renderPercentileMarkers = (elementId, summary) => {{
      const target = document.getElementById(elementId);
      target.innerHTML = "";
      const markers = [
        {{
          label: "P25",
          value: summary.weeklyPay25thPercentile,
          count: summary.weeklyPay25thCountOrAbove,
        }},
        {{
          label: "P50 (Median)",
          value: summary.weeklyPayMedian,
          count: summary.weeklyPayMedianCountOrAbove,
        }},
        {{
          label: "P80",
          value: summary.weeklyPay80thPercentile,
          count: summary.weeklyPay80thCountOrAbove,
        }},
        {{
          label: "P90",
          value: summary.weeklyPay90thPercentile,
          count: summary.weeklyPay90thCountOrAbove,
        }},
      ];

      for (const marker of markers) {{
        const div = document.createElement("div");
        div.className = "marker";
        div.innerHTML = `
          <div class="marker-label">${{esc(marker.label)}}</div>
          <div class="marker-value">${{asCurrency(marker.value)}}</div>
          <div class="marker-meta">${{asNumber(marker.count)}} workers at/above</div>
        `;
        target.appendChild(div);
      }}
    }};

    const chartInstances = [];

    const destroyCharts = () => {{
      for (const instance of chartInstances) {{
        try {{
          instance.destroy();
        }} catch (_err) {{
          // ignore chart disposal errors in static page context
        }}
      }}
      chartInstances.length = 0;
    }};

    const replaceCanvasWithError = (canvasId, message) => {{
      const canvas = document.getElementById(canvasId);
      if (!canvas || !canvas.parentElement) return;
      canvas.parentElement.innerHTML = `<div class="chart-error">${{esc(message)}}</div>`;
    }};

    const shortLabel = (value, max = 32) => {{
      const text = String(value ?? "");
      return text.length <= max ? text : `${{text.slice(0, max - 1)}}...`;
    }};

    const buildWeeklyHistogram = (values, targetBins = 8) => {{
      if (!values.length) return {{ labels: [], counts: [] }};
      const min = Math.min(...values);
      const max = Math.max(...values);
      if (min === max) {{
        return {{
          labels: [`${{asCurrency(min)}}`],
          counts: [values.length],
        }};
      }}

      const roughStep = (max - min) / targetBins;
      const step = Math.max(50, Math.ceil(roughStep / 50) * 50);
      const start = Math.floor(min / step) * step;
      const end = Math.ceil(max / step) * step;
      const binCount = Math.max(1, Math.ceil((end - start) / step));
      const counts = new Array(binCount).fill(0);

      for (const value of values) {{
        const index = Math.min(binCount - 1, Math.floor((value - start) / step));
        counts[index] += 1;
      }}

      const labels = counts.map((_count, index) => {{
        const low = start + index * step;
        const high = low + step - 1;
        return `$${{asNumber(low)}}-$${{asNumber(high)}}`;
      }});
      return {{ labels, counts }};
    }};

    const renderCharts = () => {{
      destroyCharts();

      if (typeof Chart === "undefined") {{
        replaceCanvasWithError("salaryBandChart", "Charts unavailable: Chart.js did not load.");
        replaceCanvasWithError("departmentChart", "Charts unavailable: Chart.js did not load.");
        replaceCanvasWithError("supervisorChart", "Charts unavailable: Chart.js did not load.");
        replaceCanvasWithError("weeklyPayChart", "Charts unavailable: Chart.js did not load.");
        return;
      }}

      Chart.defaults.color = "#a0a0a0";
      Chart.defaults.font.family = "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif";

      const bandRows = (REPORT_DATA.salaryBandBreakdown || []).filter((row) => row.count > 0);
      const deptRows = (REPORT_DATA.departmentBreakdown || []).slice(0, 10);
      const supervisorRows = (REPORT_DATA.supervisorBreakdown || []).slice(0, 10);
      const weeklyValues = (REPORT_DATA.workers || [])
        .map((worker) => worker.weeklyPay)
        .filter((value) => typeof value === "number" && !Number.isNaN(value));

      const bandCanvas = document.getElementById("salaryBandChart");
      if (bandCanvas && bandRows.length > 0) {{
        chartInstances.push(
          new Chart(bandCanvas, {{
            type: "doughnut",
            data: {{
              labels: bandRows.map((row) => row.label),
              datasets: [{{
                data: bandRows.map((row) => row.count),
                backgroundColor: ["#D73F09", "#2eaea2", "#a855f7", "#3b82f6", "#f59e0b"],
                borderColor: "#2c2c2c",
                borderWidth: 2,
              }}],
            }},
            options: {{
              maintainAspectRatio: false,
              cutout: "52%",
              plugins: {{
                legend: {{
                  position: "bottom",
                  labels: {{ color: "#f1f1f1", boxWidth: 12 }},
                }},
                tooltip: {{
                  callbacks: {{
                    label: (ctx) => `${{ctx.label}}: ${{asNumber(ctx.raw)}} workers`,
                  }},
                }},
              }},
            }},
          }})
        );
      }} else {{
        replaceCanvasWithError("salaryBandChart", "No salary band data available.");
      }}

      const deptCanvas = document.getElementById("departmentChart");
      if (deptCanvas && deptRows.length > 0) {{
        chartInstances.push(
          new Chart(deptCanvas, {{
            type: "bar",
            data: {{
              labels: deptRows.map((row) => shortLabel(row.department, 28)),
              datasets: [{{
                label: "Impacted workers",
                data: deptRows.map((row) => row.count),
                backgroundColor: "#D73F09",
                borderRadius: 6,
              }}],
            }},
            options: {{
              maintainAspectRatio: false,
              plugins: {{
                legend: {{ display: false }},
                tooltip: {{
                  callbacks: {{
                    afterLabel: (ctx) => `Avg weekly pay: ${{asCurrency(deptRows[ctx.dataIndex].averageWeeklyPay)}}`,
                  }},
                }},
              }},
              scales: {{
                x: {{
                  ticks: {{ color: "#a0a0a0", maxRotation: 45, minRotation: 45 }},
                  grid: {{ color: "#333" }},
                }},
                y: {{
                  beginAtZero: true,
                  ticks: {{ color: "#a0a0a0", precision: 0 }},
                  grid: {{ color: "#444" }},
                }},
              }},
            }},
          }})
        );
      }} else {{
        replaceCanvasWithError("departmentChart", "No department data available.");
      }}

      const supervisorCanvas = document.getElementById("supervisorChart");
      if (supervisorCanvas && supervisorRows.length > 0) {{
        chartInstances.push(
          new Chart(supervisorCanvas, {{
            type: "bar",
            data: {{
              labels: supervisorRows.map((row) => shortLabel(row.label, 30)),
              datasets: [{{
                label: "Impacted workers",
                data: supervisorRows.map((row) => row.count),
                backgroundColor: "#2eaea2",
                borderRadius: 6,
              }}],
            }},
            options: {{
              indexAxis: "y",
              maintainAspectRatio: false,
              plugins: {{
                legend: {{ display: false }},
                tooltip: {{
                  callbacks: {{
                    afterLabel: (ctx) =>
                      `Avg weekly pay: ${{asCurrency(supervisorRows[ctx.dataIndex].averageWeeklyPay)}}`,
                  }},
                }},
              }},
              scales: {{
                x: {{
                  beginAtZero: true,
                  ticks: {{ color: "#a0a0a0", precision: 0 }},
                  grid: {{ color: "#444" }},
                }},
                y: {{
                  ticks: {{ color: "#a0a0a0" }},
                  grid: {{ color: "#333" }},
                }},
              }},
            }},
          }})
        );
      }} else {{
        replaceCanvasWithError("supervisorChart", "No supervisor data available.");
      }}

      const histogram = buildWeeklyHistogram(weeklyValues, 9);
      const weeklyCanvas = document.getElementById("weeklyPayChart");
      if (weeklyCanvas && histogram.labels.length > 0) {{
        chartInstances.push(
          new Chart(weeklyCanvas, {{
            type: "bar",
            data: {{
              labels: histogram.labels,
              datasets: [{{
                label: "Workers",
                data: histogram.counts,
                backgroundColor: "#a855f7",
                borderRadius: 4,
              }}],
            }},
            options: {{
              maintainAspectRatio: false,
              plugins: {{
                legend: {{ display: false }},
              }},
              scales: {{
                x: {{
                  ticks: {{ color: "#a0a0a0", maxRotation: 50, minRotation: 50 }},
                  grid: {{ color: "#333" }},
                }},
                y: {{
                  beginAtZero: true,
                  ticks: {{ color: "#a0a0a0", precision: 0 }},
                  grid: {{ color: "#444" }},
                }},
              }},
            }},
          }})
        );
      }} else {{
        replaceCanvasWithError("weeklyPayChart", "No weekly pay data available.");
      }}
    }};

    const state = {{
      search: "",
      sortKey: "weeklyPay",
      sortDirection: "desc",
      filteredWorkers: [...REPORT_DATA.workers],
    }};

    const searchableText = (worker) => [
      worker.name,
      worker.department,
      worker.jobTitle,
      worker.supervisor
    ].join(" ").toLowerCase();

    const applyFilters = () => {{
      const query = state.search.trim().toLowerCase();
      const workers = REPORT_DATA.workers.filter((worker) => {{
        if (!query) return true;
        return searchableText(worker).includes(query);
      }});

      workers.sort((a, b) => compareValues(a, b, state.sortKey, state.sortDirection));
      state.filteredWorkers = workers;
      renderWorkerTable();
    }};

    const renderWorkerTable = () => {{
      const tbody = document.getElementById("workerTableBody");
      tbody.innerHTML = "";
      const rows = state.filteredWorkers;
      for (const worker of rows) {{
        const tr = document.createElement("tr");
        const annualClass = typeof worker.annualSalary === "number" ? "num" : "missing";
        const weeklyClass = typeof worker.weeklyPay === "number" ? "num" : "missing";
        tr.innerHTML = `
          <td>${{esc(worker.name)}}</td>
          <td>${{esc(worker.department)}}</td>
          <td>${{esc(worker.jobTitle)}}</td>
          <td class="${{annualClass}}">${{asCurrency(worker.annualSalary)}}</td>
          <td class="${{weeklyClass}}">${{asCurrency(worker.weeklyPay)}}</td>
          <td>${{esc(worker.apptStatus)}}</td>
          <td class="num">${{typeof worker.fte === "number" ? asNumber(worker.fte, 2) : "Missing"}}</td>
          <td>${{esc(worker.hireDate)}}</td>
          <td>${{esc(worker.supervisor)}}</td>
        `;
        tbody.appendChild(tr);
      }}
      document.getElementById("visibleCount").textContent = `${{rows.length.toLocaleString()}} shown`;
    }};

    const wireSortHandlers = () => {{
      document.querySelectorAll("th[data-sort]").forEach((header) => {{
        header.addEventListener("click", () => {{
          const key = header.dataset.sort;
          if (state.sortKey === key) {{
            state.sortDirection = state.sortDirection === "asc" ? "desc" : "asc";
          }} else {{
            state.sortKey = key;
            state.sortDirection = key === "name" ? "asc" : "desc";
          }}
          applyFilters();
        }});
      }});
    }};

    const renderPage = () => {{
      const summary = REPORT_DATA.summary;
      document.getElementById("subtitle").textContent =
        `Workbook rows: ${{REPORT_DATA.rowCount.toLocaleString()}} | Salary matches: ${{summary.salaryMatches.toLocaleString()}} (${{summary.percentMatched.toFixed(1)}}%)`;

      document.getElementById("kpiTotal").textContent = summary.totalImpactedWorkers.toLocaleString();
      document.getElementById("kpiMatches").textContent =
        `${{summary.salaryMatches.toLocaleString()}} / ${{summary.totalImpactedWorkers.toLocaleString()}}`;
      document.getElementById("kpiP80").textContent = asCurrency(summary.weeklyPay80thPercentile);
      document.getElementById("kpiMedian").textContent = asCurrency(summary.weeklyPayMedian);

      renderBarList("deptBreakdown", REPORT_DATA.departmentBreakdown, "department", "count", 15);
      renderCountAndAverageList("supervisorBreakdown", REPORT_DATA.supervisorBreakdown, 12);
      renderCountAndAverageList("roleBreakdown", REPORT_DATA.roleBreakdown, 12);
      renderBarList("bandBreakdown", REPORT_DATA.salaryBandBreakdown);
      renderPercentileMarkers("percentileMarkers", summary);
      renderPayrollByBand("bandPayrollBreakdown", REPORT_DATA.salaryBandBreakdown);
      renderCharts();

      document.getElementById("sourceWorkbook").textContent = REPORT_DATA.sourceWorkbook;
      document.getElementById("generatedAt").textContent = REPORT_DATA.generatedAt;

      if (REPORT_DATA.unmatchedNames.length > 0) {{
        document.getElementById("unmatchedList").textContent =
          `Workers without salary match (${{REPORT_DATA.unmatchedNames.length}}): ` +
          REPORT_DATA.unmatchedNames.join(", ");
      }}

      const searchInput = document.getElementById("searchInput");
      searchInput.addEventListener("input", (event) => {{
        state.search = event.target.value;
        applyFilters();
      }});

      wireSortHandlers();
      applyFilters();
    }};

    renderPage();
  </script>
</body>
</html>
"""


def write_html(payload: dict[str, Any], output_path: Path) -> None:
    json_blob = json.dumps(payload, ensure_ascii=True, separators=(",", ":"))
    output_path.write_text(html_template(json_blob))


def main() -> int:
    args = parse_args()
    workbook_rows = read_workbook_rows(args.workbook)
    lookup, lookup_keys = build_index_lookup(args.index)
    workers = build_workers(workbook_rows, lookup, lookup_keys)
    payload = build_payload(args.workbook, workbook_rows, workers)
    write_html(payload, args.output)

    p80 = payload["summary"]["weeklyPay80thPercentile"]
    p80_text = f"${p80:,.2f}" if isinstance(p80, (int, float)) else "Missing"
    print(f"Wrote report: {args.output}")
    print(f"Impacted workers: {payload['summary']['totalImpactedWorkers']}")
    print(f"Salary matches: {payload['summary']['salaryMatches']}")
    print(f"80th percentile weekly pay: {p80_text}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
