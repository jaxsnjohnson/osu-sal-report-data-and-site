#!/usr/bin/env python3
"""
Benchmark the COLA evaluation hotspot in split_data.py.

This script compares:
- current loop semantics (event dict lookups/validation per person)
- optimized semantics (precomputed COLA evaluation tuples)

It validates parity on the full dataset before reporting timing deltas.
"""

import gc
import json
import os
import statistics
import sys
import time


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import split_data


def load_fixture():
    with open(split_data.RAW_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)

    snapshot_dates = set()
    snap_pay_map = {}
    index = {}

    for name, person in data.items():
        timeline = person.get("Timeline", [])
        timeline.sort(key=lambda s: s.get("Date") or "")

        snap_by_date_pay = {}
        for snap in timeline:
            date = snap.get("Date")
            if not date:
                continue
            snapshot_dates.add(date)
            snap_by_date_pay[date] = split_data.calculate_snapshot_pay(snap)
        snap_pay_map[name] = snap_by_date_pay

        last_snap = timeline[-1] if timeline else None
        last_src = ((last_snap or {}).get("Source") or "").lower()
        index[name] = {"_isUnclass": ("unclass" in last_src)}

    cola_pairs = split_data.build_cola_pairs(sorted(snapshot_dates), split_data.COLA_EVENTS)
    cola_eval_pairs = []
    for event in cola_pairs:
        before_date = event.get("beforeDate")
        after_date = event.get("afterDate")
        if not before_date or not after_date:
            continue
        if before_date == after_date:
            continue
        cola_eval_pairs.append((
            before_date,
            after_date,
            event["pct"] - split_data.COLA_TOLERANCE_PCT,
            event["label"],
        ))

    return data, index, snap_pay_map, cola_pairs, cola_eval_pairs


def run_current(data, index, snap_pay_map, cola_pairs):
    results = {}
    for name in data.keys():
        idx = index.get(name)
        if not idx:
            continue

        if idx.get("_isUnclass"):
            results[name] = (True, 0, tuple(), False)
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
            if pct_change >= (event["pct"] - split_data.COLA_TOLERANCE_PCT):
                cola_received = True
            else:
                cola_missed.append(event["label"])

        results[name] = (
            cola_received,
            cola_checked,
            tuple(cola_missed),
            (not cola_received and cola_checked > 0),
        )
    return results


def run_optimized(data, index, snap_pay_map, cola_eval_pairs):
    results = {}
    for name in data.keys():
        idx = index.get(name)
        if not idx:
            continue

        if idx.get("_isUnclass"):
            results[name] = (True, 0, tuple(), False)
            continue

        snap_by_date_pay = snap_pay_map.get(name, {})
        cola_received = False
        cola_checked = 0
        cola_missed = []
        for before_date, after_date, required_pct, label in cola_eval_pairs:
            before_pay = snap_by_date_pay.get(before_date, 0.0)
            if before_pay <= 0:
                continue
            after_pay = snap_by_date_pay.get(after_date, 0.0)
            cola_checked += 1
            pct_change = ((after_pay - before_pay) / before_pay) * 100.0
            if pct_change >= required_pct:
                cola_received = True
            else:
                cola_missed.append(label)

        results[name] = (
            cola_received,
            cola_checked,
            tuple(cola_missed),
            (not cola_received and cola_checked > 0),
        )
    return results


def benchmark(fn, rounds=20):
    samples = []
    gc.disable()
    try:
        for _ in range(rounds):
            t0 = time.perf_counter()
            fn()
            t1 = time.perf_counter()
            samples.append(t1 - t0)
    finally:
        gc.enable()
    return samples


def summarize(name, samples, baseline_mean):
    mean = statistics.mean(samples)
    stdev = statistics.stdev(samples)
    delta_pct = ((mean - baseline_mean) / baseline_mean) * 100.0
    print(
        f"{name:20s} mean={mean*1000:.3f}ms "
        f"stdev={stdev*1000:.3f}ms delta={delta_pct:+.2f}%"
    )
    return mean


def main():
    data, index, snap_pay_map, cola_pairs, cola_eval_pairs = load_fixture()

    print(f"people={len(data)}")
    print(f"cola_pairs_total={len(cola_pairs)}")
    print(f"cola_eval_pairs={len(cola_eval_pairs)}")

    # Warmup
    for _ in range(5):
        run_current(data, index, snap_pay_map, cola_pairs)
        run_optimized(data, index, snap_pay_map, cola_eval_pairs)

    current_out = run_current(data, index, snap_pay_map, cola_pairs)
    optimized_out = run_optimized(data, index, snap_pay_map, cola_eval_pairs)
    if current_out != optimized_out:
        raise AssertionError("Parity failure: current and optimized COLA outputs differ")

    print("\n[cola-loop benchmark]")
    current_samples = benchmark(lambda: run_current(data, index, snap_pay_map, cola_pairs))
    optimized_samples = benchmark(
        lambda: run_optimized(data, index, snap_pay_map, cola_eval_pairs)
    )
    current_mean = statistics.mean(current_samples)
    summarize("current", current_samples, current_mean)
    summarize("optimized", optimized_samples, current_mean)
    print("\nPARITY_OK")


if __name__ == "__main__":
    main()
