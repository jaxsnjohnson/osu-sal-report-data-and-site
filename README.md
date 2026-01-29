# OSU Salary Transparency

**A civic hacking project to visualize and explore Oregon State University personnel salary data.**

![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)
![Maintenance](https://img.shields.io/badge/Maintained%3F-yes-green.svg)
![Data Source](https://img.shields.io/badge/Source-Public%20Records-orange)

## ⚠️ Important Disclaimer

**This tool is for informational and research purposes only.**

* **Source Data:** Data is parsed from publicly available PDF salary reports released by Oregon State University.
* **Accuracy:** While we strive for accuracy, the parsing process (OCR and text extraction) may introduce errors. Name changes, specific stipends, or bonuses may not be reflected.
* **Verification:** Always verify specific figures against the official [OSU Salary Reports](https://hr.oregonstate.edu/employees/administrators-supervisors/classification-compensation/salary-reports).
* **Scope:** This dataset generally excludes temporary employees, student workers, and certain non-salary compensation (per diem, bonuses).

## 🎯 Purpose

The **OSU Salary Transparency** project aims to make public salary data actually *accessible*. While PDF reports are technically "public," they are difficult to analyze, search, or track over time. This tool provides:

* **Search & Filter:** Instantly find personnel by name, organization, or role.
* **Visualizations:** See salary distributions, median pay, and organizational leaderboards.
* **Transparency:** Distinguish between "Classified" (Union represented) and "Unclassified" staff.

## 📂 Data Sources & Definitions

* **Official Reports:** [OSU HR Classification & Compensation](https://hr.oregonstate.edu/employees/administrators-supervisors/classification-compensation/salary-reports)
* **Classified Staff:** Personnel represented by [SEIU 503](https://seiu503.org) (and [Sublocal 083](https://www.local083.org)).
* **Unclassified Staff:** Faculty, professional faculty, administrators, and other staff not represented by SEIU 503.

**Data Range:** Collection began in 2025. Historical data prior to this date is not currently available in this explorer.

## 🛠️ Tech Stack

This project is built with a philosophy of simplicity and longevity. No complex frameworks, no heavy build steps.

* **Frontend:** Vanilla JavaScript, CSS, HTML.
* **Data Processing:** Python 3 (Standard Library), Bash, and `pdftotext`.
* **Hosting:** Static site (GitHub Pages).

## 🚀 Getting Started

To run this project locally or process new data, follow these steps.

### Prerequisites

You will need a Unix-like environment (Linux, macOS, or WSL) with the following installed:

1.  **Python 3** (No `pip install` required; uses standard libraries only).
2.  **Poppler Utils** (Required for `pdftotext`).

**Install Poppler:**
* **Ubuntu/Debian:** `sudo apt-get install poppler-utils`
* **macOS (Homebrew):** `brew install poppler`

### Installation

1.  **Clone the repository:**
    ```bash
    git clone [https://github.com/jaxsnjohnson/osu-sal-report-data-and-site.git](https://github.com/jaxsnjohnson/osu-sal-report-data-and-site.git)
    cd osu-sal-report-data-and-site
    ```

2.  **Add PDF Reports:**
    Place any new OSU salary report PDFs into the `reports/` directory.

3.  **Process Data:**
    Run the conversion script to parse PDFs and generate `data.json`:
    ```bash
    chmod +x convert_data.sh
    ./convert_data.sh
    ```

4.  **Run the Site:**
    Since this is a static site, you can open `index.html` directly in your browser, or use a simple local server:
    ```bash
    python3 -m http.server 8000
    ```
    Visit `http://localhost:8000` to view.

## 🤝 Contributing

This is a community-focused "civic hacking" project. Contributions are welcome!

* **Found a Bug?** Open a [GitHub Issue](https://github.com/jaxsnjohnson/osu-sal-report-data-and-site/issues).
* **Want to Add Features?** Fork the repo, create a branch, and submit a Pull Request.
* **Data Corrections:** If you notice a parsing error in specific records, please report it via Issues so we can refine the regex logic.

## 📄 License

This project is licensed under the **GNU General Public License v3.0 (GPLv3)**.
You are free to use, modify, and distribute this software, but all derivative works must remain open-source and available to the community.

---

*This project is an independent experiment and is not officially endorsed by Oregon State University.*
