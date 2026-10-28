// Drives the real UI in headless Chromium against the simulated Cribl API.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');

const page_url = (q = '') => 'file://' + path.join(__dirname, 'dist', 'index.html') + q;
const results = [];
/** Pick an option in the App's dropdown (Select.tsx). */
async function choose(page, name, optionLabel) {
  await page.getByRole('combobox', { name }).first().click();
  await page.getByRole('option', { name: optionLabel, exact: true }).click();
}
const comboValue = (page, name) => page.getByRole('combobox', { name }).first().getAttribute('data-value');
const step = async (name, fn) => {
  try {
    await fn();
    results.push(`ok   ${name}`);
  } catch (e) {
    results.push(`FAIL ${name}: ${e.message.split('\n')[0]}`);
    throw e;
  }
};

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
  const consoleErrors = [];
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
  page.on('pageerror', (e) => consoleErrors.push(e.message));
  const state = () => page.evaluate(() => {
    const s = window.__mock;
    return {
      lookups: Object.fromEntries(Object.entries(s.lookups).map(([g, m]) => [g, [...m.keys()]])),
      commits: s.commits.map((c) => c.group),
      deploys: s.deploys.map((d) => d.group),
      exports: s.searchExports.map((e) => e.name),
    };
  });

  try {
    await page.goto(page_url());
    await step('loads with an empty lookup list', async () => {
      await page.getByRole('heading', { name: /Lookup Manager/ }).waitFor();
      await page.getByText(/^v\d+\.\d+\.\d+$/).first().waitFor();
      await page.getByText('No lookups yet.').waitFor();
    });

    await step('creates an IP subnet lookup from the template and previews it', async () => {
      await page.getByRole('button', { name: 'New lookup' }).click();
      await page.getByRole('button', { name: /IP and subnet mapping/ }).click();
      await page.getByRole('button', { name: 'Test source and preview' }).click();
      await page.getByText('9 source row(s)').waitFor();
      assert.ok(await page.getByRole('cell', { name: '10.20.1.0/24' }).isVisible());
      await page.screenshot({ path: path.join(__dirname, 'shot-editor.png'), fullPage: true });
      await page.getByRole('checkbox', { name: 'chris_demo' }).check();
      await page.getByRole('button', { name: 'Save lookup' }).click();
      await page.getByRole('cell', { name: /IP and subnet mapping/ }).first().waitFor();
    });

    await step('runs it: publishes to Search and both Stream groups, commits and deploys each', async () => {
      await page.getByRole('button', { name: 'Run now' }).first().click();
      await page.getByText('Result:').waitFor({ timeout: 20000 });
      const s = await state();
      assert.deepEqual(s.lookups.default, ['ip_subnets.csv']);
      assert.deepEqual(s.lookups.chris_demo, ['ip_subnets.csv']);
      assert.deepEqual(s.lookups.default_search, ['ip_subnets.csv']);
      assert.deepEqual(s.commits, ['default', 'chris_demo']);
      assert.deepEqual(s.deploys, ['default', 'chris_demo']);
      assert.ok(await page.locator('.lm-panel .lm-badge-success').isVisible());
      await page.screenshot({ path: path.join(__dirname, 'shot-list.png'), fullPage: true });
    });

    await step('creates an asset lookup from a Lake search and runs it', async () => {
      await page.getByRole('button', { name: 'New lookup' }).click();
      await page.getByRole('button', { name: /Asset inventory/ }).click();
      await page.getByRole('button', { name: 'Test source and preview' }).click();
      await page.getByText('3 source row(s)').waitFor({ timeout: 20000 });
      assert.ok(await page.getByRole('cell', { name: 'svc_backup' }).isVisible());
      await page.getByRole('button', { name: 'Save lookup' }).click();
      await page.getByRole('cell', { name: /Asset inventory/ }).first().waitFor();
      const row = page.getByRole('row', { name: /Asset inventory/ });
      await row.getByRole('button', { name: 'Run now' }).click();
      await page.getByText('Result:').waitFor({ timeout: 20000 });
      const s = await state();
      assert.ok(s.lookups.default.includes('asset_inventory.csv'));
    });

    await step('previews an external threat-intel feed with field mapping', async () => {
      await page.getByRole('button', { name: 'New lookup' }).click();
      await page.getByRole('button', { name: /Threat intelligence indicators/ }).click();
      await page.getByRole('button', { name: 'Test source and preview' }).click();
      await page.getByText('2 source row(s)').waitFor();
      assert.ok(await page.getByRole('cell', { name: 'Emotet' }).isVisible());
      await page.getByRole('button', { name: 'Cancel' }).last().click();
    });

    await step('validation blocks saving without a target', async () => {
      await page.getByRole('button', { name: 'New lookup' }).click();
      await page.getByRole('button', { name: /Custom lookup/ }).click();
      await page.getByLabel('Cribl Search (use in Lake searches)').uncheck();
      await page.getByLabel('default', { exact: true }).uncheck();
      await page.getByRole('button', { name: 'Save lookup' }).click();
      await page.getByText('Choose at least one target').waitFor();
      await page.getByRole('button', { name: 'Cancel' }).last().click();
    });

    await step('shows run history', async () => {
      const row = page.getByRole('row', { name: /IP and subnet mapping/ });
      await row.getByRole('button', { name: 'History' }).click();
      await page.getByRole('heading', { name: /History: IP and subnet mapping/ }).waitFor();
      await page.getByText(/Created ip_subnets\.csv, committed/).first().waitFor();
      await page.getByRole('button', { name: 'Back' }).click();
    });

    await step('diagnostics pass against the simulated API', async () => {
      await page.getByRole('button', { name: 'Settings' }).click();
      await page.getByRole('button', { name: 'Run diagnostics' }).click();
      await page.getByText('Backend function (scheduled runs):').waitFor({ timeout: 30000 });
      const errs = await page.locator('.lm-checks .lm-dot-error').count();
      assert.equal(errs, 0);
      await page.screenshot({ path: path.join(__dirname, 'shot-settings.png'), fullPage: true });
    });

    await step('search-based lookup falls back to export when the Search lookups API is missing', async () => {
      await page.goto(page_url('?searchApi=off'));
      await page.getByRole('button', { name: 'New lookup' }).click();
      await page.getByRole('button', { name: /Service and port mapping/ }).click();
      await page.getByRole('button', { name: /Ports observed in firewall traffic/ }).click();
      await page.getByRole('button', { name: 'Save lookup' }).click();
      await page.getByRole('button', { name: 'Run now' }).first().click();
      await page.getByText('Result:').waitFor({ timeout: 20000 });
      const s = await state();
      assert.deepEqual(s.exports, ['service_ports']);
    });

    await step('Splunk direct: browse lookups, pick one, preview, then run an SPL query', async () => {
      await page.goto(page_url());
      await page.getByRole('button', { name: 'New lookup' }).click();
      await page.getByRole('button', { name: /Asset inventory/ }).click();
      await page.getByRole('button', { name: /Splunk lookup, direct/ }).click();
      await page.getByLabel('Splunk management URL').fill('https://splunk.example.com:8089');
      await page.getByRole('button', { name: 'Browse Splunk lookups' }).click();
      await page.getByText('3 lookup(s) in Splunk').waitFor();
      assert.ok(await page.getByText('KV store: assets_by_str').isVisible());
      await page.getByLabel('Filter Splunk lookups').fill('cmdb');
      await page.getByRole('button', { name: 'Use cmdb_assets.csv' }).click();
      assert.equal(await page.getByRole('textbox', { name: /^Splunk lookup/ }).inputValue(), 'cmdb_assets.csv');
      await page.getByRole('button', { name: 'Test source and preview' }).click();
      await page.getByText('2 source row(s)').waitFor();
      assert.ok(await page.getByRole('cell', { name: 'WIN-SRV-FS01' }).isVisible());
      await page.getByLabel('Splunk search (SPL) results').check();
      await page.getByRole('textbox', { name: /^Splunk search \(SPL\)/ }).fill('index=assets | stats latest(os) as os by ip');
      await page.getByRole('button', { name: 'Test source and preview' }).click();
      await page.getByText('2 source row(s)').waitFor();
      const sent = await page.evaluate(() => window.__mock.splunkCalls.at(-1).body);
      assert.ok(new URLSearchParams(sent).get('search').startsWith('search index=assets'), sent);
      await page.screenshot({ path: path.join(__dirname, 'shot-splunk.png'), fullPage: true });
    });

    await step('lifecycle: name clash, rename with cleanup, change preview, delete with removal', async () => {
      await page.goto(page_url());
      // First lookup, published to Search + default.
      await page.getByRole('button', { name: 'New lookup' }).click();
      await page.getByRole('button', { name: /IP and subnet mapping/ }).click();
      await page.getByRole('button', { name: 'Save lookup' }).click();
      await page.getByRole('button', { name: 'Run now' }).first().click();
      await page.getByText('Result:').waitFor({ timeout: 20000 });
      // Same template again: clash warning, then jump to the existing one.
      await page.getByRole('button', { name: 'New lookup' }).click();
      await page.getByRole('button', { name: /IP and subnet mapping/ }).click();
      await page.getByText('Another lookup already uses the file name').waitFor();
      await page.getByRole('button', { name: 'edit the existing lookup' }).click();
      await page.getByRole('heading', { name: 'Edit: IP and subnet mapping' }).waitFor();
      // Unchanged data: preview shows no differences against the published copy.
      await page.getByRole('button', { name: 'Test source and preview' }).click();
      await page.getByText('Changes compared with the published version').waitFor();
      await page.getByText('No differences: publishing would not change the data.').waitFor();
      // Rename: offer to remove the old file, then do it on save.
      await page.getByRole('textbox', { name: /^File name/ }).fill('network_zones');
      await page.getByText(/remove the previously published ip_subnets\.csv from: Search, default/).waitFor();
      await page.getByRole('button', { name: 'Save lookup' }).click();
      await page.getByText('Saved IP and subnet mapping').waitFor({ timeout: 20000 });
      await page.getByText(/Removed ip_subnets\.csv, committed/).first().waitFor();
      let st = await state();
      assert.ok(!st.lookups.default.includes('ip_subnets.csv') && !st.lookups.default_search.includes('ip_subnets.csv'), JSON.stringify(st.lookups));
      await page.getByText('network_zones.csv').first().waitFor();
      await page.getByRole('button', { name: 'Run now' }).first().click();
      await page.getByText('Result:').waitFor({ timeout: 20000 });
      st = await state();
      assert.ok(st.lookups.default.includes('network_zones.csv'));
      // Delete and remove what was published.
      await page.getByRole('button', { name: 'Delete', exact: true }).first().click();
      await page.getByRole('button', { name: /Delete and remove from Search, default/ }).click();
      await page.getByText('Deleted IP and subnet mapping').waitFor({ timeout: 20000 });
      await page.getByText(/Removed network_zones\.csv, committed/).first().waitFor();
      await page.getByText('No lookups yet.').waitFor();
      st = await state();
      assert.ok(!st.lookups.default.includes('network_zones.csv') && !st.lookups.default_search.includes('network_zones.csv'));
      await page.screenshot({ path: path.join(__dirname, 'shot-lifecycle.png'), fullPage: true });
    });

    await step('combining sources: CMDB first, traffic fills zones and adds unknown hosts', async () => {
      await page.goto(page_url());
      await page.getByRole('button', { name: 'New lookup' }).click();
      await page.getByRole('button', { name: /Asset inventory/ }).click();
      await page.getByRole('button', { name: /Splunk CMDB \+ zones and unknown hosts/ }).click();
      assert.equal(await page.getByRole('textbox', { name: /Additional source 1: name/ }).inputValue(), 'Observed in firewall traffic');
      await page.getByRole('button', { name: 'Test source and preview' }).click();
      await page.getByText('Merged “Observed in firewall traffic”: 3 row(s) read, 2 empty cell(s) filled, 2 new row(s) added.').waitFor({ timeout: 20000 });
      assert.ok(await page.getByRole('cell', { name: 'observed:pan_traffic' }).first().isVisible());
      assert.ok(await page.getByRole('cell', { name: 'WIN-SRV-FS01' }).isVisible());
      await page.screenshot({ path: path.join(__dirname, 'shot-merge.png'), fullPage: true });
      // Add a second source, then remove it.
      await page.getByRole('button', { name: 'Add a source' }).click();
      await page.getByRole('textbox', { name: /Additional source 2: name/ }).waitFor();
      await page.getByRole('button', { name: 'Remove source' }).last().click();
      assert.equal(await page.getByRole('textbox', { name: /Additional source 2: name/ }).count(), 0);
      // Save keeps the extra source on the definition.
      await page.getByRole('button', { name: 'Save lookup' }).click();
      await page.getByRole('cell', { name: /Asset inventory/ }).first().waitFor();
      const saved = await page.evaluate(() => [...window.__mock.kv.entries()].filter(([k]) => k.startsWith('lm-def')).map(([, v]) => JSON.parse(v))[0]);
      assert.equal(saved.extraSources.length, 1);
      assert.equal(saved.extraSources[0].addNewKeys, true);
    });

    await step('scheduling: saving an hourly Lake-based lookup creates its scheduled search', async () => {
      await page.goto(page_url());
      await page.getByRole('button', { name: 'New lookup' }).click();
      await page.getByRole('button', { name: /Asset inventory/ }).click();
      await choose(page, /^Schedule/, 'Hourly');
      await page.getByText(/Saving creates 1 Cribl Search scheduled search/).waitFor();
      await page.getByRole('button', { name: 'Save lookup' }).click();
      await page.getByText(/Scheduled search lm_src_asset_inventory_main \(5 \* \* \* \* UTC\)/).waitFor({ timeout: 20000 });
      let ss = await page.evaluate(() => [...window.__mock.savedSearches.keys()]);
      assert.deepEqual(ss, ['lm_src_asset_inventory_main']);
      await page.getByRole('cell', { name: 'Every 1 h' }).waitFor();
      // Back to manual: the scheduled search is removed.
      await page.getByRole('button', { name: 'Edit' }).first().click();
      await choose(page, /^Schedule/, 'Manual only');
      await page.getByRole('button', { name: 'Save lookup' }).click();
      await page.getByText('Schedule turned off; scheduled searches removed.').waitFor({ timeout: 20000 });
      ss = await page.evaluate(() => [...window.__mock.savedSearches.keys()]);
      assert.deepEqual(ss, []);
    });

    await step('Splunk through the laptop worker: request, preview, lookup list', async () => {
      await page.goto(page_url());
      await page.getByRole('button', { name: 'New lookup' }).click();
      await page.getByRole('button', { name: /Asset inventory/ }).click();
      await choose(page, /^Source type/, "Splunk through a Stream worker (for a Splunk Cribl.Cloud can't reach): lookup file or SPL query");
      await choose(page, 'Worker Group', 'chris_demo');
      await page.getByText('The source type changed, so the field mapping was reset').waitFor();
      await page.getByRole('textbox', { name: /^Splunk lookup name/ }).fill('cmdb_assets.csv');
      await page.getByText('Not requested yet.').waitFor();
      await page.getByRole('button', { name: 'Request from Splunk now' }).click();
      await page.getByText(/Last requested .* \(sync /).waitFor({ timeout: 10000 });
      await page.getByRole('button', { name: 'Test source and preview' }).click();
      await page.getByText('2 source row(s)').waitFor({ timeout: 20000 });
      assert.ok(await page.getByRole('cell', { name: 'WIN-SRV-FS01' }).isVisible());
      const job = await page.evaluate(() => window.__mock.jobRuns.at(-1));
      assert.equal(job.group, 'chris_demo');
      assert.ok(job.config.input.metadata.some((x) => x.name === 'sync_id'));
      // Lookup list through the worker.
      await page.getByRole('button', { name: 'Request lookup list from Splunk' }).click();
      await page.getByText(/Lookup list requested from Splunk/).waitFor({ timeout: 10000 });
      await page.getByRole('button', { name: 'Show lookup list' }).click();
      await page.getByText('2 lookup(s) in Splunk').waitFor({ timeout: 20000 });
      await page.getByRole('button', { name: 'Use asset_lookup_by_str' }).click();
      assert.equal(await page.getByRole('textbox', { name: /^Splunk lookup name/ }).inputValue(), 'asset_lookup_by_str');
      await page.screenshot({ path: path.join(__dirname, 'shot-worker.png'), fullPage: true });
    });

    await step('context and usability: getting started, help, composite keys, .tsv.gz upload, summary, Use panel', async () => {
      await page.goto(page_url());
      await page.getByText('Choose a template').waitFor();
      await page.getByRole('button', { name: 'Create your first lookup' }).click();
      await page.getByRole('button', { name: /Service and port mapping/ }).click();
      // Composite key shown as two ticked key boxes.
      assert.ok(await page.getByRole('checkbox', { name: 'Use port as key' }).isChecked());
      assert.ok(await page.getByRole('checkbox', { name: 'Use protocol as key' }).isChecked());
      // Section help.
      await page.getByText('What is this?').nth(1).click();
      await page.getByText(/tick several for a composite key/).waitFor();
      // Upload a gzipped TSV.
      const zlib = require('node:zlib');
      const tsv = 'port\tprotocol\tservice_name\tdescription\trisk\n3389\ttcp\tms-wbt-server\tRDP\thigh\n53\tudp\tdomain\tDNS\tlow\n53\ttcp\tdomain\tDNS over TCP\tlow';
      await page.getByLabel('Upload a lookup file').setInputFiles({ name: 'ports.tsv.gz', mimeType: 'application/gzip', buffer: zlib.gzipSync(tsv) });
      await page.waitForFunction(() => document.querySelector('[role="combobox"][aria-label="Format"]')?.getAttribute('data-value') === 'tsv');
      assert.equal(await comboValue(page, /^Format/), 'tsv');
      await page.getByRole('button', { name: 'Test source and preview' }).click();
      await page.getByText('3 source row(s)').waitFor();
      assert.equal(await page.getByRole('cell', { name: 'domain' }).count(), 2, 'same port, different protocol: two rows');
      await page.getByRole('button', { name: 'Save lookup' }).click();
      await page.getByLabel('Summary').waitFor();
      await page.getByRole('button', { name: 'Use', exact: true }).click();
      await page.getByText('Cribl Stream: Lookup function (pipeline JSON)').waitFor();
      assert.ok((await page.locator('.lm-codeblock pre').first().innerText()).includes('"eventField": "dest_port"'));
      await page.getByRole('textbox', { name: /matched to “port”/ }).fill('dport');
      assert.ok((await page.locator('.lm-codeblock pre').nth(1).innerText()).includes('| lookup service_ports on dport=port, protocol=protocol'));
      await page.screenshot({ path: path.join(__dirname, 'shot-usage.png'), fullPage: true });
    });

    await step('dropdowns: readable in light and dark mode, mouse and keyboard selection, outside click closes', async () => {
      const luminance = (rgb) => {
        const [r, g, b] = rgb.match(/\d+/g).slice(0, 3).map((v) => {
          const c = Number(v) / 255;
          return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const contrast = (a, b) => {
        const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
        return (l1 + 0.05) / (l2 + 0.05);
      };
      for (const scheme of ['light', 'dark']) {
        await page.emulateMedia({ colorScheme: scheme });
        await page.goto(page_url());
        await page.getByRole('button', { name: 'New lookup' }).click();
        await page.getByRole('button', { name: /IP and subnet mapping/ }).click();
        await page.getByRole('combobox', { name: 'Source type' }).click();
        const opts = page.getByRole('option');
        assert.equal(await opts.count(), 6);
        for (let i = 0; i < 6; i++) {
          const { color, bg, text } = await opts.nth(i).evaluate((el) => {
            const cs = getComputedStyle(el);
            let node = el;
            let bg = cs.backgroundColor;
            while (bg === 'rgba(0, 0, 0, 0)' && node.parentElement) {
              node = node.parentElement;
              bg = getComputedStyle(node).backgroundColor;
            }
            return { color: cs.color, bg, text: el.textContent };
          });
          assert.ok(text.length > 3, 'option has text');
          const ratio = contrast(color, bg);
          assert.ok(ratio >= 4.5, `${scheme}: "${text}" contrast ${ratio.toFixed(2)} (${color} on ${bg})`);
        }
        if (scheme === 'dark') await page.screenshot({ path: path.join(__dirname, 'shot-dropdown-dark.png') });
        // Mouse: pick HTTP(S) API; the list closes and stays closed.
        await page.getByRole('option', { name: 'HTTP(S) API', exact: true }).click();
        assert.equal(await page.getByRole('listbox').count(), 0);
        assert.equal(await comboValue(page, 'Source type'), 'http');
        await page.getByLabel('URL').waitFor();
      }
      await page.emulateMedia({ colorScheme: 'light' });
      // Keyboard: Match mode from Exact (this template is CIDR) via arrows and Enter; letter jump; Escape.
      const mm = page.getByRole('combobox', { name: 'Match mode' });
      await mm.focus();
      await page.keyboard.press('ArrowDown');
      await page.getByRole('listbox', { name: 'Match mode' }).waitFor();
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      assert.equal(await comboValue(page, 'Match mode'), 'regex');
      await page.keyboard.press('e');
      assert.equal(await comboValue(page, 'Match mode'), 'exact', 'typing a letter jumps while closed');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Escape');
      assert.equal(await page.getByRole('listbox').count(), 0);
      assert.equal(await comboValue(page, 'Match mode'), 'exact', 'Escape does not change the value');
      // Outside click closes.
      await mm.click();
      await page.getByRole('heading', { name: /New lookup/ }).click();
      assert.equal(await page.getByRole('listbox').count(), 0);
    });

    await step('help: Help tab, topic search, pager, quick start link, and guide panel keeps unsaved edits', async () => {
      await page.goto(page_url());
      await page.getByRole('button', { name: 'Read the quick start' }).click();
      await page.getByRole('heading', { name: 'Quick start: your first lookup in five minutes' }).waitFor();
      await page.getByRole('button', { name: /Templates →/ }).click();
      await page.getByRole('heading', { name: 'Templates', exact: true }).waitFor();
      await page.getByLabel('Search the guide').fill('composite');
      const topics = await page.getByRole('navigation', { name: 'Guide topics' }).getByRole('button').allInnerTexts();
      assert.ok(topics.includes('Keys and matching') && topics.length < 13, topics.join(' | '));
      await page.getByRole('button', { name: 'Keys and matching' }).click();
      await page.getByText(/so 53\/udp and 53\/tcp are different rows/).waitFor();
      await page.screenshot({ path: path.join(__dirname, 'shot-help.png'), fullPage: true });
      // From the editor: the guide opens in a panel; the unsaved title survives.
      await page.getByRole('button', { name: 'Lookups', exact: true }).click();
      await page.getByRole('button', { name: 'Create your first lookup' }).click();
      await page.getByRole('button', { name: /Custom lookup/ }).click();
      await page.getByRole('textbox', { name: /^Title/ }).fill('My unsaved lookup');
      await page.getByRole('button', { name: 'Open the guide: 4. Map source fields to columns' }).click();
      const drawer = page.getByRole('dialog', { name: 'Lookup Manager guide' });
      await drawer.getByRole('heading', { name: 'Mapping source fields to columns' }).waitFor();
      await page.screenshot({ path: path.join(__dirname, 'shot-help-drawer.png') });
      await page.keyboard.press('Escape');
      assert.equal(await page.getByRole('dialog').count(), 0);
      assert.equal(await page.getByRole('textbox', { name: /^Title/ }).inputValue(), 'My unsaved lookup');
    });

    await step('no browser console errors', async () => {
      assert.deepEqual(consoleErrors, []);
    });
  } catch {
    /* reported below */
  } finally {
    await browser.close();
    console.log(results.join('\n'));
    if (consoleErrors.length) console.log('Console errors:\n' + consoleErrors.join('\n'));
    process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
  }
})();
