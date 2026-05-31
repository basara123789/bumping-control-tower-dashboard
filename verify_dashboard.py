import argparse
import sys
from pathlib import Path


REQUIRED_MARKERS = [
    "VERSION: bumping-dashboard-20260531-a1b1-layout",
    "NO CHART.JS REQUIRED",
    "SINGLE FILE OFFLINE BUILD",
    "Production KPI Overview",
    "A1 / B1 Interactive Factory Layout",
    "DRY",
    "WET1",
    "WET2",
    "generateMockDashboardData",
    "advanceSimulation",
    "buildKpis",
    "buildEnvironment",
    "buildAlarmTable",
    "layout-zone",
    "machine-tile",
    "Lam PLL205",
    "FRP 202",
    "canvas id=\"alarmTrend\"",
    "canvas id=\"radarChart\"",
]

FORBIDDEN_MARKERS = [
    "src=\"chart.js",
    "src='chart.js",
    "new Chart(",
    "cdn.jsdelivr",
    "unpkg.com",
    "cdnjs.cloudflare.com",
]


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify the offline dashboard transfer file.")
    parser.add_argument("file", nargs="?", default="dist/dashboard.html", help="Dashboard HTML file to verify")
    args = parser.parse_args()

    target = Path(args.file)
    if not target.exists():
        print(f"FAIL: file not found: {target}")
        return 1

    text = target.read_text(encoding="utf-8", errors="replace")
    lowered = text.lower()

    missing = [marker for marker in REQUIRED_MARKERS if marker not in text]
    forbidden = [marker for marker in FORBIDDEN_MARKERS if marker.lower() in lowered]

    if missing:
        print("FAIL: missing required marker(s):")
        for marker in missing:
            print(f"  - {marker}")
        return 1

    if forbidden:
        print("FAIL: forbidden marker(s) found:")
        for marker in forbidden:
            print(f"  - {marker}")
        return 1

    print("PASS: dashboard file looks like the official offline build.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
