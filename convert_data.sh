#!/bin/bash
set -euo pipefail

TXT_DIR="temp_txt"
FORCE="${FORCE_REBUILD:-0}"
WRITE_RAW="${WRITE_RAW_DATA:-0}"

mkdir -p "$TXT_DIR"

echo "Step 1: Converting changed PDFs in 'reports/' to cached text..."

converted=0
skipped=0
for pdf in reports/*.pdf; do
    [ -e "$pdf" ] || continue
    filename=$(basename "$pdf")
    txtname="${filename%.*}.txt"
    txtpath="$TXT_DIR/$txtname"

    if [ "$FORCE" = "1" ] || [ ! -f "$txtpath" ] || [ "$pdf" -nt "$txtpath" ]; then
        pdftotext -layout "$pdf" "$txtpath"
        converted=$((converted + 1))
        echo "Converted: $filename"
    else
        skipped=$((skipped + 1))
    fi
done

stale=0
for txt in "$TXT_DIR"/*.txt; do
    [ -e "$txt" ] || continue
    base=$(basename "$txt" .txt)
    if [ ! -e "reports/$base.pdf" ]; then
        rm -f "$txt"
        stale=$((stale + 1))
    fi
done

echo "PDF text cache: $converted converted, $skipped unchanged, $stale stale removed."

echo "Step 2: Parsing reports and generating web data artifacts..."
if [ "$WRITE_RAW" = "1" ]; then
    python3 split_data.py --from-reports --write-raw-data data.json
else
    python3 split_data.py --from-reports
fi

echo "Done."
