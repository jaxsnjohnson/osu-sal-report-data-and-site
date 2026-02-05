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

python3 - <<EOF > data.json
import os
import re
import json
import glob

INPUT_DIR = "temp_txt"
FILES = glob.glob(os.path.join(INPUT_DIR, "*.txt"))
DATE_PATTERN = re.compile(r'(\d{4}-\d{2}-\d{2})')

database = {}

def parse_single_file(filepath):
    filename = os.path.basename(filepath)
    date_match = DATE_PATTERN.search(filename)
    report_date = date_match.group(1) if date_match else "Unknown Date"
    
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    raw_blocks = re.split(r'-{10,}', content)
    
    keys = [
        "Name", "Home Orgn", "Job Orgn", "Job Title", "Rank", 
        "Appt Begin Date", "Appt End Date", "First Hired", 
        "Adj Service Date", "Job Type", "Posn-Suff", 
        "Rank Effective Date", "Appt Percent", "Annual Salary Rate",
        "Full-Time Monthly Salary", "Appt", "Hourly Rate"
    ]
    # Sort keys by length desc to capture 'Appt End Date' before 'Appt'
    keys.sort(key=len, reverse=True)

    # UPDATED REGEX:
    # 1. \s*: allows space before colon ("Key :")
    # 2. (?=\s*...) allows ZERO spaces before next key ("ValueNextKey:")
    key_pattern = r'(' + '|'.join(keys) + r')\s*:\s*(.*?)(?=\s*(?:' + '|'.join(keys) + r')\s*:|\s*$)'

    for block in raw_blocks:
        if not block.strip(): continue

        person_name = None
        static_info = {}
        jobs = []
        current_job = {}

        lines = block.split('\n')
        for line in lines:
            matches = re.findall(key_pattern, line)
            for key, value in matches:
                value = value.strip()
                
                # RECOVERY CHECK:
                # If the regex failed and the value still contains "Annual Salary Rate:", 
                # we force clean it here.
                if "Annual Salary Rate:" in value:
                     # Extract the number from the messy string
                     sal_match = re.search(r'Annual Salary Rate:.*?([\d,]+\.?\d*)', value)
                     if sal_match:
                         # We found the salary hiding in the wrong field!
                         # Save it to the current job, and clean the current value
                         hidden_salary = sal_match.group(1)
                         current_job["Annual Salary Rate"] = hidden_salary
                         value = value.split("Annual Salary Rate:")[0].strip()

                if key == "Name": person_name = value
                
                if key in current_job:
                    jobs.append(current_job)
                    current_job = {}

                # --- SPLIT SALARY TERM ---
                if key == "Annual Salary Rate":
                    match = re.search(r'([\d,]+\.?\d*)\s*(.*)', value)
                    if match:
                        value = match.group(1).replace(',', '') # Just the number
                        term_part = match.group(2).strip()
                        if term_part:
                            # Handle "term only" rows where salary rate is blank and only "9 mo"/"12 mo" appears
                            try:
                                term_num = int(float(value))
                            except:
                                term_num = None
                            if term_part == "mo" and term_num in (9, 10, 11, 12):
                                current_job["Salary Term"] = f"{term_num} mo"
                                value = ""
                            else:
                                current_job["Salary Term"] = term_part
                
                elif key == "Full-Time Monthly Salary":
                     match = re.search(r'[\d,]+\.?\d*', value)
                     if match: value = match.group(0).replace(',', '')

                elif key == "Hourly Rate":
                     match = re.search(r'[\d,]+\.?\d*', value)
                     if match: value = match.group(0).replace(',', '')

                job_keys = [
                    "Job Orgn", "Job Title", "Appt Begin Date", "Appt End Date",
                    "Job Type", "Posn-Suff", "Rank", "Rank Effective Date",
                    "Appt Percent", "Annual Salary Rate", 
                    "Full-Time Monthly Salary", "Appt", "Hourly Rate"
                ]

                if key in job_keys:
                    current_job[key] = value
                else:
                    if key != "Name": static_info[key] = value

        if current_job: jobs.append(current_job)

        # Normalization
        for job in jobs:
            if "Annual Salary Rate" not in job:
                if "Hourly Rate" in job:
                    try:
                        hourly = float(job["Hourly Rate"])
                        annual = hourly * 2080
                        job["Annual Salary Rate"] = "{:.2f}".format(annual)
                    except: pass
                elif "Full-Time Monthly Salary" in job:
                    try:
                        monthly = float(job["Full-Time Monthly Salary"])
                        annual = monthly * 12
                        job["Annual Salary Rate"] = "{:.2f}".format(annual)
                    except: pass

        if person_name:
            if person_name not in database:
                database[person_name] = { "Meta": static_info, "Timeline": [] }
            
            database[person_name]["Timeline"].append({
                "Date": report_date, "Source": filename, "Jobs": jobs, "SnapshotDetails": static_info 
            })

for txt_file in FILES: parse_single_file(txt_file)

for person in database:
    # Sort the timeline by date
    database[person]["Timeline"].sort(key=lambda x: x["Date"])
    
    # NEW: Aggregate a list of all reports (sources) this person appears in
    database[person]["Reports"] = [entry["Source"] for entry in database[person]["Timeline"]]

print(json.dumps(database, indent=2))
EOF

echo "Step 3: Splitting data.json into web-friendly chunks..."
python3 split_data.py

rm -rf temp_txt
echo "Done."
