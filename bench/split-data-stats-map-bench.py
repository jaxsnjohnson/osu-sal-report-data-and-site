#!/usr/bin/env python3
"""
Benchmark the stats_map hotspot in split_data.py.

This script compares current-style logic versus the optimized defaultdict
approach on real data.json rows, and verifies parity for:
- stats_map values
- peer_buckets structural counts (per date/key list lengths)
"""

import gc
import json
import os
import statistics
import sys
import time
from collections import defaultdict


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import split_data


def load_rows():
    with open(split_data.RAW_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)

    rows = []
    for person in data.values():
        timeline = person.get("Timeline", [])
        timeline.sort(key=lambda s: s.get("Date") or "")
        for snap in timeline:
            date = snap.get("Date")
            if not date:
                continue

            src = (snap.get("Source") or "").lower()
            is_unclass = "unclass" in src
            jobs = snap.get("Jobs") or []
            snap_pay = split_data.calculate_snapshot_pay(snap)

            primary_job = jobs[0] if jobs else None
            peer_key = None
            if primary_job:
                org = primary_job.get("Job Orgn") or "Unknown"
                role = primary_job.get("Job Title") or "Unknown"
                peer_key = f"{org}||{role}"

            rows.append((date, is_unclass, snap_pay, peer_key))
    return rows


def current_stats_only(rows):
    stats_map = {}
    for date, is_unclass, snap_pay, _peer_key in rows:
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
        if is_unclass:
            stats_map[date]["unclassified"] += 1
            stats_map[date]["payrollUnclassified"] += snap_pay
        else:
            stats_map[date]["classified"] += 1
            stats_map[date]["payrollClassified"] += snap_pay
    return stats_map


def optimized_stats_only(rows):
    stats_map = defaultdict(lambda: {
        "date": "",
        "classified": 0,
        "unclassified": 0,
        "payroll": 0.0,
        "payrollClassified": 0.0,
        "payrollUnclassified": 0.0,
    })
    for date, is_unclass, snap_pay, _peer_key in rows:
        entry = stats_map[date]
        if not entry["date"]:
            entry["date"] = date
        entry["payroll"] += snap_pay
        if is_unclass:
            entry["unclassified"] += 1
            entry["payrollUnclassified"] += snap_pay
        else:
            entry["classified"] += 1
            entry["payrollClassified"] += snap_pay
    return stats_map


def current_stats_and_peers(rows):
    stats_map = {}
    peer_buckets = defaultdict(lambda: defaultdict(list))
    for date, is_unclass, snap_pay, peer_key in rows:
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
        if is_unclass:
            stats_map[date]["unclassified"] += 1
            stats_map[date]["payrollUnclassified"] += snap_pay
        else:
            stats_map[date]["classified"] += 1
            stats_map[date]["payrollClassified"] += snap_pay

        if peer_key:
            peer_buckets[date][peer_key].append(snap_pay)
    return stats_map, peer_buckets


def optimized_stats_and_peers(rows):
    stats_map = defaultdict(lambda: {
        "date": "",
        "classified": 0,
        "unclassified": 0,
        "payroll": 0.0,
        "payrollClassified": 0.0,
        "payrollUnclassified": 0.0,
    })
    peer_buckets = defaultdict(lambda: defaultdict(list))
    for date, is_unclass, snap_pay, peer_key in rows:
        entry = stats_map[date]
        if not entry["date"]:
            entry["date"] = date
        entry["payroll"] += snap_pay
        if is_unclass:
            entry["unclassified"] += 1
            entry["payrollUnclassified"] += snap_pay
        else:
            entry["classified"] += 1
            entry["payrollClassified"] += snap_pay

        if peer_key:
            peer_buckets[date][peer_key].append(snap_pay)
    return stats_map, peer_buckets


def run_benchmark(fn, rows, rounds=20, batch=8):
    samples = []
    gc.disable()
    try:
        for _ in range(rounds):
            t0 = time.perf_counter()
            for _ in range(batch):
                fn(rows)
            t1 = time.perf_counter()
            samples.append((t1 - t0) / batch)
    finally:
        gc.enable()
    return samples


def summarize(name, samples, baseline_mean):
    mean = statistics.mean(samples)
    stdev = statistics.stdev(samples)
    delta_pct = ((mean - baseline_mean) / baseline_mean) * 100.0
    print(
        f"{name:24s} mean={mean*1000:.3f}ms "
        f"stdev={stdev*1000:.3f}ms delta={delta_pct:+.2f}%"
    )
    return mean


def peer_bucket_counts(peer_buckets):
    return {
        date: {key: len(values) for key, values in bucket.items()}
        for date, bucket in peer_buckets.items()
    }


def main():
    rows = load_rows()
    print(f"rows={len(rows)}")

    # Warmup
    for _ in range(5):
        current_stats_only(rows)
        optimized_stats_only(rows)
        current_stats_and_peers(rows)
        optimized_stats_and_peers(rows)

    print("\n[stats-only benchmark]")
    current_samples = run_benchmark(current_stats_only, rows)
    optimized_samples = run_benchmark(optimized_stats_only, rows)
    current_mean = statistics.mean(current_samples)
    summarize("current_stats_only", current_samples, current_mean)
    summarize("optimized_stats_only", optimized_samples, current_mean)

    print("\n[stats+peer_buckets benchmark]")
    current_full_samples = run_benchmark(current_stats_and_peers, rows)
    optimized_full_samples = run_benchmark(optimized_stats_and_peers, rows)
    current_full_mean = statistics.mean(current_full_samples)
    summarize("current_stats_and_peers", current_full_samples, current_full_mean)
    summarize("optimized_stats_and_peers", optimized_full_samples, current_full_mean)

    current_stats, current_peers = current_stats_and_peers(rows)
    optimized_stats, optimized_peers = optimized_stats_and_peers(rows)

    if dict(current_stats) != dict(optimized_stats):
        raise AssertionError("Parity failure: stats_map differs")
    if peer_bucket_counts(current_peers) != peer_bucket_counts(optimized_peers):
        raise AssertionError("Parity failure: peer_buckets structure differs")

    print("\nPARITY_OK stats_map and peer_buckets structural counts match")


if __name__ == "__main__":
    main()
