import { defineConfig, devices } from '@playwright/test';

const webPort = process.env.HAPPY_WEB_PORT || '19006';
const baseURL = process.env.HAPPY_WEB_URL || `http://localhost:${webPort}`;
const serverUrl = process.env.HAPPY_SERVER_URL || 'http://localhost:3005';

export default defineConfig({
    testDir: './tests',
    fullyParallel: true,
    timeout: 60_000,
    expect: { timeout: 10_000 },
    retries: 0,
    maxFailures: 1,
    reporter: [['list']],
    use: {
        baseURL,
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        video: 'retain-on-failure',
    },
    webServer: {
        command: `powershell -ExecutionPolicy Bypass -File "./scripts/happy-web-test.ps1" -ServerUrl "${serverUrl}" -WebPort ${webPort}`,
        url: baseURL,
        reuseExistingServer: true,
        timeout: 120_000,
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
});
