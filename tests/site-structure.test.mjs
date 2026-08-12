import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(testDirectory, '..');
const siteSource = fs.readFileSync(path.join(root, 'site.js'), 'utf8');
const visualCss = fs.readFileSync(path.join(root, 'visual-2026.css'), 'utf8');

const pageMap = {
  'index.html': 'home',
  'missions.html': 'missions',
  'mission.html': 'mission',
  'systems.html': 'systems',
  'platform.html': 'platform',
  'industries.html': 'industries',
  'industry.html': 'industry',
  'contact.html': 'contact',
};

function readSiteData() {
  const dataBoundary = siteSource.indexOf('const q=');
  assert.notEqual(dataBoundary, -1, 'site data must remain above the DOM helpers');
  const context = {};
  vm.runInNewContext(
    `${siteSource.slice(0, dataBoundary)}\n` +
      'globalThis.__siteData={missions,systems,industries,systemNavigation,contactOptions,contactSectors};',
    context,
  );
  return JSON.parse(JSON.stringify(context.__siteData));
}

test('the root directory is the complete runnable site', () => {
  for (const [fileName, pageName] of Object.entries(pageMap)) {
    const filePath = path.join(root, fileName);
    assert.ok(fs.existsSync(filePath), `${fileName} should exist at the project root`);
    const html = fs.readFileSync(filePath, 'utf8');
    assert.match(html, /<meta charset="utf-8">/);
    assert.match(html, /href="styles\.css"/);
    assert.match(html, /href="visual-2026\.css(?:\?[^\"]+)?"/);
    assert.match(html, /<script src="site\.js(?:\?[^\"]+)?" defer><\/script>/);
    assert.match(html, new RegExp(`data-page="${pageName}"`));
  }

});

test('GitHub Pages declares the production custom domain', () => {
  const customDomain = fs.readFileSync(path.join(root, 'CNAME'), 'utf8').trim();
  assert.equal(customDomain, 'blueshieldrobotics.com');
});

test('the legacy recovery archive matches its manifest', () => {
  const archiveRoot = path.join(root, 'docs', 'references', 'legacy');
  const manifestPath = path.join(archiveRoot, 'archive-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  assert.equal(manifest.version, 1);
  assert.equal(manifest.items.length, 9);
  assert.equal(manifest.items.filter((item) => item.category.includes('artwork')).length, 7);
  assert.equal(manifest.items.filter((item) => item.category === 'pre-migration-source').length, 2);

  for (const item of manifest.items) {
    const filePath = path.resolve(archiveRoot, item.path);
    assert.ok(
      filePath.startsWith(`${archiveRoot}${path.sep}`),
      `${item.path} should remain inside the legacy archive`,
    );
    assert.ok(fs.existsSync(filePath), `${item.path} should exist in the legacy archive`);
    assert.equal(fs.statSync(filePath).size, item.bytes, `${item.path} should preserve its byte length`);
    const digest = createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
    assert.equal(digest, item.sha256, `${item.path} should preserve its SHA-256 digest`);
  }
});

test('the obsolete nested source folder is not part of the canonical project tree', () => {
  assert.equal(
    fs.existsSync(path.join(root, 'Blueshield网站设计')),
    false,
    'the retired duplicate source folder should not be reintroduced',
  );
});

test('navigation data matches the approved taxonomy', () => {
  const data = readSiteData();

  assert.equal(data.missions.length, 8);
  assert.equal(data.systems.length, 4);
  assert.deepEqual(
    data.systemNavigation.map((group) => group.label),
    ['Air Systems', 'Marine Systems', 'Integrated Capabilities'],
  );
  assert.deepEqual(
    data.systemNavigation[0].items.map((item) => item.label),
    ['Scout S1', 'Atlas A300', 'Meridian M9'],
  );
  assert.deepEqual(
    data.systemNavigation[1].items.map((item) => item.label),
    ['Dolphin D1', 'Air–Sea Search & Rescue'],
  );
  assert.deepEqual(
    data.systemNavigation[2].items.map((item) => item.label),
    ['Payloads & Sensors', 'Autonomy & Mission Intelligence', 'Communications & Ground Control'],
  );

  assert.deepEqual(
    data.industries.map((industry) => industry.name),
    [
      'Defence & National Security',
      'Border, Maritime & Coastal Security',
      'Public Safety & Emergency Services',
      'Surveying, Geospatial & Digital Twins',
      'Utilities & Critical Infrastructure',
      'Mining & Resources',
      'Construction & Major Projects',
      'Agriculture, Forestry & Environment',
    ],
  );

  assert.deepEqual(
    data.contactOptions,
    [
      { value: 'capability-briefing', label: 'Request a Capability Briefing' },
      { value: 'demonstration', label: 'Arrange a Demonstration' },
      { value: 'pilot-program', label: 'Discuss a Pilot Program' },
      { value: 'general-enquiry', label: 'General Enquiry' },
    ],
  );
});

test('navigation state and contact request wiring remain accessible', () => {
  assert.match(siteSource, /aria-controls="primary-navigation"/);
  assert.match(siteSource, /<nav class="nav-links" id="primary-navigation" aria-label="Primary">/);
  assert.match(siteSource, /class="mega-group" role="group" aria-label=/);
  assert.doesNotMatch(siteSource, /aria-haspopup=/);
  assert.match(siteSource, /openItem\.querySelector\(':scope > \.nav-trigger'\)\?\.focus\(\)/);
  assert.match(siteSource, /matchMedia\('\(max-width:920px\)'\)/);
  assert.match(siteSource, /addEventListener\('change',\(\)=>setMobileNavOpen\(nav,toggle,false\)\)/);
  assert.match(siteSource, /requestType\.value=contactOptions\.some/);
  assert.match(siteSource, /contact\.html\?request=capability-briefing">Request a Capability Briefing<\/a>/);
  assert.match(visualCss, /\.nav-item:not\(\.open\)>\.mega\{opacity:0;visibility:hidden/);
});

test('the contact page exposes the verified company email', () => {
  assert.match(siteSource, /<address class="contact-direct">/);
  assert.match(
    siteSource,
    /href="mailto:info@blueshieldrobotics\.com">info@blueshieldrobotics\.com<\/a>/,
  );
  assert.doesNotMatch(siteSource, /blurshieldrobotics\.com/);
});

test('the contact page is wired to the secure enquiry coordinator', () => {
  const contactHtml = fs.readFileSync(path.join(root, 'contact.html'), 'utf8');
  const contactFormSource = fs.readFileSync(path.join(root, 'contact-form.js'), 'utf8');
  const contactConfigSource = fs.readFileSync(path.join(root, 'contact-config.js'), 'utf8');
  const data = readSiteData();

  assert.match(contactHtml, /<script src="contact-config\.js\?v=[^"]+" defer><\/script>/);
  assert.match(contactHtml, /<script src="contact-form\.js\?v=[^"]+" defer><\/script>/);
  assert.match(siteSource, /name="requestType"/);
  assert.doesNotMatch(siteSource, /contact-required-note|Required fields/);
  assert.match(siteSource, /<label for="requestType">Enquiry type <span class="field-required" aria-hidden="true">\*<\/span><\/label><select id="requestType"[^>]* required>/);
  assert.match(siteSource, /<label for="name">Name <span class="field-required" aria-hidden="true">\*<\/span><\/label><input id="name"[^>]* required>/);
  assert.match(siteSource, /<label for="email">Email <span class="field-required" aria-hidden="true">\*<\/span><\/label><input id="email"[^>]* required>/);
  assert.match(siteSource, /<label for="sector">Sector <span class="field-required" aria-hidden="true">\*<\/span><\/label><select id="sector"[^>]* required>/);
  assert.match(siteSource, /<label for="org">Organisation<\/label><input id="org"[^>]*><\/div>/);
  assert.match(siteSource, /<label for="mission">Mission requirement<\/label><textarea id="mission"[^>]*><\/textarea>/);
  assert.equal((siteSource.match(/class="field-required"/g) || []).length, 4);
  assert.doesNotMatch(siteSource, /id="org"[^>]*\srequired(?=[ >])/);
  assert.doesNotMatch(siteSource, /id="mission"[^>]*\srequired(?=[ >])/);
  assert.match(siteSource, /name="website" tabindex="-1"/);
  assert.match(siteSource, /id="contactTurnstile"/);
  assert.match(siteSource, /Do not include classified, export-controlled or security-sensitive operational information/);
  assert.doesNotMatch(siteSource, /is ready to send once the form is connected/);
  assert.match(contactFormSource, /Idempotency|submissionId/);
  assert.match(contactConfigSource, /turnstileAction:'contact_enquiry'/);
  assert.match(contactFormSource, /action:config\.turnstileAction/);
  assert.match(contactFormSource, /method:'POST'/);
  assert.match(contactFormSource, /response\.status!==202\|\|result\.ok!==true/);
  assert.doesNotMatch(contactConfigSource, /RESEND_API_KEY|TURNSTILE_SECRET_KEY/);
  assert.deepEqual(
    data.contactSectors.map((sector) => sector.value),
    [
      'defence-national-security',
      'border-maritime-coastal-security',
      'public-safety-emergency-services',
      'surveying-geospatial-digital-twins',
      'utilities-critical-infrastructure',
      'mining-resources',
      'construction-major-projects',
      'agriculture-forestry-environment',
      'other',
    ],
  );
});

test('all referenced assets exist in the organised root asset folders', () => {
  for (const folder of ['brand', 'products', 'missions', 'industries']) {
    assert.ok(fs.statSync(path.join(root, 'assets', folder)).isDirectory());
  }

  const assetReferences = new Set(
    `${siteSource}\n${visualCss}`.match(/assets\/[A-Za-z0-9_./-]+\.(?:png|jpe?g|webp|svg)/g) ?? [],
  );
  assert.ok(assetReferences.size > 0, 'the site should reference local assets');
  for (const reference of assetReferences) {
    assert.ok(fs.existsSync(path.join(root, reference)), `${reference} should resolve from the root site`);
  }

  assert.doesNotMatch(siteSource, /assets\/(?:scout-s1|atlas-a300|meridian-m9|dolphin-d1)\.png/);
});

test('the existing hero motion values are preserved for the deferred animation phase', () => {
  assert.match(
    visualCss,
    /\.hero-editorial \.brand-matrix\{[^}]*animation:matrixDrift 24s ease-in-out infinite alternate/,
  );
  assert.match(visualCss, /\.type-line\{[^}]*animation:typeTrackIn \.8s cubic-bezier\(\.2,\.75,\.15,1\) forwards/);
  assert.match(visualCss, /\.type-line:nth-child\(2\)\{animation-delay:\.1s}/);
  assert.match(visualCss, /\.type-line:nth-child\(3\)\{animation-delay:\.2s}/);
  assert.match(visualCss, /\.type-line:nth-child\(4\)\{animation-delay:\.3s}/);
  assert.match(
    visualCss,
    /@media\(prefers-reduced-motion:reduce\)\{\.type-line\{opacity:1!important;transform:none!important}\./,
  );
});
