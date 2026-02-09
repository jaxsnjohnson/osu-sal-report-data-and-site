#!/usr/bin/env python3
import json
import os
import re
import string
from bisect import bisect_left, bisect_right
from collections import defaultdict

COLA_EVENTS = [
    {"label": "6.5% COLA", "effective": "2024-04-01", "pct": 6.5},
    {"label": "2% COLA", "effective": "2024-11-01", "pct": 2.0},
    {"label": "3.5% COLA", "effective": "2025-06-01", "pct": 3.5},
]
COLA_TOLERANCE_PCT = 0.4

_NON_NUMERIC_RE = re.compile(r"[^0-9.-]+")

ROOT = os.path.dirname(os.path.abspath(__file__))
RAW_PATH = os.path.join(ROOT, "data.json")
OUT_DIR = os.path.join(ROOT, "data")
PEOPLE_DIR = os.path.join(OUT_DIR, "people")
INDEX_PATH = os.path.join(OUT_DIR, "index.json")
AGG_PATH = os.path.join(OUT_DIR, "aggregates.json")


def parse_float(val):
    if val is None:
        return None
    if isinstance(val, (int, float)):
        return float(val)
    cleaned = _NON_NUMERIC_RE.sub("", str(val))
    if not cleaned:
        return None
    try:
        return float(cleaned)
    except (TypeError, ValueError, OverflowError):
        return None


def calc_job_rate_and_missing(job):
    raw_rate = job.get("Annual Salary Rate")
    rate_num = parse_float(raw_rate)
    term = (job.get("Salary Term") or "").strip()
    missing = False
    if term == "mo" and rate_num is not None and rate_num > 0 and rate_num <= 12:
        missing = True
        rate = 0.0
    else:
        rate = rate_num or 0.0
    pct = parse_float(job.get("Appt Percent")) or 0.0
    return rate, pct, missing


def calculate_snapshot_pay(snapshot):
    if not snapshot or not snapshot.get("Jobs"):
        return 0.0
    total = 0.0
    for job in snapshot.get("Jobs", []):
        rate, pct, _missing = calc_job_rate_and_missing(job)
        if rate > 0:
            total += rate * (pct / 100.0)
    return total


def _median_sorted(vals):
    n = len(vals)
    if n == 0:
        return 0.0
    mid = n >> 1
    if n & 1:
        return vals[mid]
    return (vals[mid - 1] + vals[mid]) * 0.5


def median(values, presorted=False):
    n = len(values)
    if n == 0:
        return 0.0
    if n == 1:
        return values[0]
    if n == 2:
        return (values[0] + values[1]) / 2.0

    vals = values if presorted else sorted(values)
    return _median_sorted(vals)


def build_cola_pairs(dates, events):
    if not dates:
        return []
    pairs = []
    for event in events:
        before = None
        after = None
        for d in dates:
            if d <= event["effective"]:
                before = d
            if after is None and d >= event["effective"]:
                after = d
        pairs.append({
            "label": event["label"],
            "effective": event["effective"],
            "pct": event["pct"],
            "beforeDate": before,
            "afterDate": after,
        })
    return pairs


def bucket_for_name(name):
    if not name:
        return "_"
    ch = name.strip()[0].lower()
    if ch in string.ascii_lowercase:
        return ch
    return "_"


def main():
    if not os.path.exists(RAW_PATH):
        raise SystemExit(f"Missing {RAW_PATH}. Run convert_data.sh first.")

    with open(RAW_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)

    os.makedirs(PEOPLE_DIR, exist_ok=True)

    index = {}
    buckets = defaultdict(dict)
    snap_pay_map = {}

    all_roles = set()
    snapshot_dates = set()
    stats_map = {}
    peer_buckets = defaultdict(lambda: defaultdict(list))
    class_transitions = {}

    latest_class_date = ""
    latest_unclass_date = ""

    # First pass: compute aggregates + index
    for name, person in data.items():
        timeline = person.get("Timeline", [])
        timeline.sort(key=lambda s: s.get("Date") or "")

        role_set = set()
        snap_by_date_pay = {}

        last_snap = timeline[-1] if timeline else None
        last_job = (last_snap.get("Jobs") or [{}])[0] if last_snap else {}

        pay_missing = False
        is_full_time = False
        total_pay = 0.0
        is_unclass = False
        last_date = last_snap.get("Date") if last_snap else None

        prev_is_unclass = None
        was_excluded = False
        first_exclusion_date = None
        started_classified = None  # track initial classification
        for idx, snap in enumerate(timeline):
            date = snap.get("Date")
            if date:
                snapshot_dates.add(date)

            src = (snap.get("Source") or "").lower()
            is_unclass = "unclass" in src
            if started_classified is None:
                started_classified = not is_unclass  # True if first snapshot is classified

            if prev_is_unclass is not None and (not prev_is_unclass) and is_unclass:
                if started_classified:
                    was_excluded = True
                    if not first_exclusion_date:
                        first_exclusion_date = date
            if prev_is_unclass is not None and is_unclass != prev_is_unclass and date:
                year = date[:4]
                if year:
                    entry = class_transitions.setdefault(year, {
                        "year": year,
                        "toUnclassified": 0,
                        "toClassified": 0
                    })
                    if is_unclass:
                        entry["toUnclassified"] += 1
                    else:
                        entry["toClassified"] += 1

            jobs = snap.get("Jobs") or []
            for job in jobs:
                title = job.get("Job Title")
                if title:
                    all_roles.add(title)
                    role_set.add(title.lower())

            snap_pay = calculate_snapshot_pay(snap)
            if date:
                snap_by_date_pay[date] = snap_pay

            # stats + peer buckets
            if date:
                if date not in stats_map:
                    stats_map[date] = {
                        "date": date,
                        "classified": 0,
                        "unclassified": 0,
                        "payroll": 0.0,
                        "payrollClassified": 0.0,
                        "payrollUnclassified": 0.0,
                    }
                stats_map[date]["payroll"] += snap_pay
                if "unclass" in src:
                    stats_map[date]["unclassified"] += 1
                    stats_map[date]["payrollUnclassified"] += snap_pay
                else:
                    stats_map[date]["classified"] += 1
                    stats_map[date]["payrollClassified"] += snap_pay

                primary_job = jobs[0] if jobs else None
                if primary_job:
                    org = primary_job.get("Job Orgn") or "Unknown"
                    role = primary_job.get("Job Title") or "Unknown"
                    key = f"{org}||{role}"
                    peer_buckets[date][key].append(snap_pay)

            if idx == len(timeline) - 1:
                total_pay = snap_pay
                # missing rate detection for last snapshot
                pay_missing = any(calc_job_rate_and_missing(job)[2] for job in jobs)
                # full-time detection for last snapshot
                for job in jobs:
                    _rate, pct, _missing = calc_job_rate_and_missing(job)
                    if pct >= 100:
                        is_full_time = True
                        break

            prev_is_unclass = is_unclass

        if last_snap:
            last_src = (last_snap.get("Source") or "").lower()
            is_unclass = "unclass" in last_src
            if last_date:
                if is_unclass:
                    if last_date > latest_unclass_date:
                        latest_unclass_date = last_date
                else:
                    if last_date > latest_class_date:
                        latest_class_date = last_date

        snap_pay_map[name] = snap_by_date_pay

        meta = person.get("Meta", {})
        search_role = last_job.get("Job Title") or ""
        search_org = last_job.get("Job Orgn") or ""
        search_str = f"{name} {meta.get('Home Orgn', '')} {meta.get('First Hired', '')} {search_role} {search_org}".lower()

        index[name] = {
            "Meta": {
                "First Hired": meta.get("First Hired", ""),
                "Home Orgn": meta.get("Home Orgn", ""),
                "Adj Service Date": meta.get("Adj Service Date", ""),
            },
            "_hasTimeline": bool(timeline),
            "_lastDate": last_date or "",
            "_lastJob": last_job,
            "_totalPay": total_pay,
            "_payMissing": pay_missing,
            "_isUnclass": is_unclass,
            "_isFullTime": is_full_time,
            "_roleStr": "\0".join(sorted(role_set)),
            "_searchStr": search_str,
            "_colaReceived": True,
            "_colaChecked": 0,
            "_colaMissedLabels": [],
            "_colaMissing": False,
            "_wasExcluded": was_excluded and is_unclass,
            "_exclusionDate": first_exclusion_date if (was_excluded and is_unclass) else "",
        }

        bucket = bucket_for_name(name)
        buckets[bucket][name] = {
            "Meta": person.get("Meta", {}),
            "Timeline": timeline,
            "_wasExcluded": was_excluded and is_unclass,
            "_exclusionDate": first_exclusion_date if (was_excluded and is_unclass) else "",
        }

    # Build peer medians + percentiles
    peer_median_map = {}
    peer_percentiles = {}
    for date, bucket_map in peer_buckets.items():
        peer_median_map[date] = {}
        for key, values in bucket_map.items():
            # Sort once so median and percentile both reuse the same ordering.
            values.sort()
            peer_median_map[date][key] = median(values, presorted=True)

    # Compute per-person peer percentile (latest snapshot org+role)
    for name, person in data.items():
        timeline = person.get("Timeline", [])
        if not timeline:
            peer_percentiles[name] = None
            continue
        last_snap = timeline[-1]
        jobs = last_snap.get("Jobs") or []
        if not jobs:
            peer_percentiles[name] = None
            continue
        primary_job = jobs[0]
        org = primary_job.get("Job Orgn") or "Unknown"
        role = primary_job.get("Job Title") or "Unknown"
        key = f"{org}||{role}"
        date = last_snap.get("Date")
        last_pay = calculate_snapshot_pay(last_snap)
        date_buckets = peer_buckets.get(date)
        bucket = date_buckets.get(key) if date_buckets else None
        if not bucket or len(bucket) <= 1 or last_pay <= 0:
            peer_percentiles[name] = None
            continue
        below = bisect_left(bucket, last_pay)
        equal = bisect_right(bucket, last_pay) - below
        peer_percentiles[name] = ((below + 0.5 * equal) / len(bucket)) * 100.0

    for name, pct in peer_percentiles.items():
        if pct is not None:
            index[name]["_peerPercentile"] = pct
        else:
            index[name]["_peerPercentile"] = None

    # COLA status (after snapshot dates are finalized)
    cola_pairs = build_cola_pairs(sorted(snapshot_dates), COLA_EVENTS)
    for name in data.keys():
        idx = index.get(name)
        if not idx:
            continue
        if idx.get("_isUnclass"):
            idx["_colaReceived"] = True
            idx["_colaChecked"] = 0
            idx["_colaMissedLabels"] = []
            idx["_colaMissing"] = False
            continue

        snap_by_date_pay = snap_pay_map.get(name, {})
        cola_received = False
        cola_checked = 0
        cola_missed = []
        for event in cola_pairs:
            before_date = event.get("beforeDate")
            after_date = event.get("afterDate")
            if not before_date or not after_date:
                continue
            if before_date == after_date:
                continue
            before_pay = snap_by_date_pay.get(before_date, 0.0)
            after_pay = snap_by_date_pay.get(after_date, 0.0)
            if before_pay <= 0:
                continue
            cola_checked += 1
            pct_change = ((after_pay - before_pay) / before_pay) * 100.0
            if pct_change >= (event["pct"] - COLA_TOLERANCE_PCT):
                cola_received = True
            else:
                cola_missed.append(event["label"])

        idx["_colaReceived"] = cola_received
        idx["_colaChecked"] = cola_checked
        idx["_colaMissedLabels"] = cola_missed
        idx["_colaMissing"] = (not cola_received and cola_checked > 0)

    history_stats = sorted(stats_map.values(), key=lambda x: x["date"])
    snapshot_dates_sorted = sorted(snapshot_dates)
    class_transitions_sorted = sorted(class_transitions.values(), key=lambda x: x["year"])

    aggregates = {
        "latestClassDate": latest_class_date,
        "latestUnclassDate": latest_unclass_date,
        "snapshotDates": snapshot_dates_sorted,
        "historyStats": history_stats,
        "classTransitions": class_transitions_sorted,
        "peerMedianMap": peer_median_map,
        "allRoles": sorted(all_roles),
    }

    with open(INDEX_PATH, "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False)
    with open(AGG_PATH, "w", encoding="utf-8") as f:
        json.dump(aggregates, f, ensure_ascii=False)

    for bucket, bucket_data in buckets.items():
        out_path = os.path.join(PEOPLE_DIR, f"{bucket}.json")
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(bucket_data, f, ensure_ascii=False)

    print(f"Wrote index: {INDEX_PATH}")
    print(f"Wrote aggregates: {AGG_PATH}")
    print(f"Wrote {len(buckets)} bucket files in {PEOPLE_DIR}")


if __name__ == "__main__":
    main()
