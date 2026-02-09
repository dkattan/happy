import { test as base, expect, type Page, type TestInfo } from '@playwright/test';

async function dumpInteractiveElements(page: Page, testInfo: TestInfo) {
    const elements = await page.evaluate(() => {
        const selectors = [
            'a',
            'button',
            'input',
            'select',
            'textarea',
            '[role="button"]',
            '[role="link"]',
            '[role="checkbox"]',
            '[role="textbox"]',
        ];
        const nodes = Array.from(document.querySelectorAll(selectors.join(',')));
        return nodes.slice(0, 250).map((el) => {
            const element = el as HTMLElement & { href?: string; value?: string; type?: string; name?: string };
            const rect = element.getBoundingClientRect();
            return {
                tag: element.tagName.toLowerCase(),
                text: element.textContent?.trim().slice(0, 200) || '',
                id: element.id || '',
                name: element.getAttribute('name') || '',
                type: element.getAttribute('type') || '',
                role: element.getAttribute('role') || '',
                ariaLabel: element.getAttribute('aria-label') || '',
                href: element.getAttribute('href') || '',
                disabled: element.hasAttribute('disabled'),
                value: (element as HTMLInputElement).value ?? '',
                x: Math.round(rect.x),
                y: Math.round(rect.y),
                width: Math.round(rect.width),
                height: Math.round(rect.height),
            };
        });
    });

    const payload = JSON.stringify({ count: elements.length, elements }, null, 2);
    await testInfo.attach('interactive-elements.json', {
        body: payload,
        contentType: 'application/json',
    });

    // Also log a compact summary for quick scanning in CI logs.
    const summary = elements
        .map((e) => `${e.tag}${e.id ? `#${e.id}` : ''}${e.role ? `(${e.role})` : ''} ${e.text}`.trim())
        .slice(0, 50)
        .join('\n');
    console.log('[playwright] Interactive elements (first 50):\n' + summary);
}

export const test = base.extend({});
export { expect };

test.afterEach(async ({ page }, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) {
        try {
            await dumpInteractiveElements(page, testInfo);
        } catch (error) {
            console.error('[playwright] Failed to dump interactive elements', error);
        }
    }
});
