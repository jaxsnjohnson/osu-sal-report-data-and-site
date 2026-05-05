#!/bin/bash

# Ensure the intermediate text folder exists
mkdir -p temp_txt

echo "Step 1: Converting all PDFs in 'reports/' to text..."

for pdf in reports/*.pdf; do
    [ -e "$pdf" ] || continue
    filename=$(basename "$pdf")
    txtname="${filename%.*}.txt"
    pdftotext -layout "$pdf" "temp_txt/$txtname"
    echo "Converted: $filename"
done

echo "Step 2: Merging and Parsing data..."

python3 scripts/salary_report_parser.py > data.json

echo "Step 3: Splitting data.json into web-friendly chunks..."
python3 split_data.py

rm -rf temp_txt
echo "Done."
