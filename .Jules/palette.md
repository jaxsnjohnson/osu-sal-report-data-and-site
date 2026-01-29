## 2024-05-23 - CSS-Only Charts
**Learning:** Complex visualizations like Donut Charts and Percentile Distributions can be built with pure CSS (`conic-gradient`) and simple JS math, avoiding heavy charting libraries.
**Action:** Use `conic-gradient` for ratio visualizations and absolute positioning with calculated percentages (linear or log) for distributions in lightweight projects.

## 2024-05-23 - Salary Visualization
**Learning:** Linear scales for salary data often result in unusable clusters due to wealth gaps or outliers.
**Action:** Always test logarithmic scales for financial data visualizations to ensure readability across the entire range.

## 2024-05-24 - Zero-Dependency Tooltips
**Learning:** For CSS-only charts (like conic-gradients) where individual DOM elements don't exist for segments, placing a `title` attribute on the container provides essential data context without external libraries.
**Action:** Always populate the `title` attribute with a data summary (e.g., "Role A: 20%, Role B: 15%") for complex CSS visualizations.
