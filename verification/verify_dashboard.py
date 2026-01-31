
from playwright.sync_api import sync_playwright, expect

def verify_dashboard():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        print("Navigating to dashboard...")
        page.goto("http://localhost:3000/index.html")

        # Wait for data to load (stats bar should show count)
        print("Waiting for data load...")
        expect(page.locator("#stat-total")).not_to_be_empty(timeout=10000)

        # Search for "Professor"
        print("Searching...")
        page.fill("#search", "Professor")

        # Wait for results
        # Debounce is 300ms, wait a bit more
        page.wait_for_timeout(1000)

        # Check if results are present
        results = page.locator("#results .card")
        count = results.count()
        print(f"Found {count} cards.")

        if count == 0:
            print("No results found! Error.")
        else:
            print("Results found. Taking screenshot.")

        # Scroll down a bit to trigger lazy loading if any, and see content
        page.evaluate("window.scrollBy(0, 200)")

        page.screenshot(path="verification/dashboard_search.png", full_page=True)

        browser.close()

if __name__ == "__main__":
    verify_dashboard()
