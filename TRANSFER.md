# Dashboard Transfer Guide

Use this guide when moving the dashboard into the company intranet through another AI assistant.

## Recommended File

Transfer only this file:

```text
dist/dashboard.html
```

It is a single-file offline build. It already contains all HTML, CSS, and JavaScript.

## Rules For The Internal AI

Give the internal AI this instruction:

```text
Fetch the raw content of dist/dashboard.html from GitHub and output it exactly.
Do not summarize.
Do not rewrite.
Do not add Chart.js.
Do not add CDN links.
Do not change formatting.
Do not split it into multiple files.
If you see chart.js or new Chart(, stop because that is the wrong version.
```

Raw URL:

```text
https://raw.githubusercontent.com/basara123789/bumping-control-tower-dashboard/main/dist/dashboard.html
```

## Version Fingerprint

The correct file contains these markers near the top:

```html
<!-- VERSION: bumping-dashboard-20260531-a1b1-layout -->
<!-- NO CHART.JS REQUIRED -->
<!-- SINGLE FILE OFFLINE BUILD: copy this file only -->
```

The correct file must not contain actual Chart.js usage:

```text
src="chart.js
src='chart.js
new Chart(
cdn.jsdelivr
unpkg.com
```

## Intranet Usage

Save the transferred content as:

```text
dashboard.html
```

Then open it directly in a browser. No Python server, npm, Chart.js, CDN, or internet access is required.

## Verification

After saving the file, run:

```powershell
python verify_dashboard.py dashboard.html
```

Expected result:

```text
PASS: dashboard file looks like the official offline build.
```
