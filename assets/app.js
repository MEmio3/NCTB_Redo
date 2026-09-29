const endpoints = [
  { method: 'GET', path: '/', type: 'HTML', title: 'Homepage', contract: 'Server-rendered homepage HTML', live: true },
  { method: 'GET', path: '/views/sitemap', type: 'HTML', title: 'HTML sitemap', contract: 'SiteMapViewWidget navigation tree', live: true },
  { method: 'GET', path: '/ajax/get/division/list', type: 'JSON', title: 'Division list', contract: 'application/json with ETag', live: true },
  { method: 'GET', path: '/pages/notices', type: 'HTML', title: 'Notices', contract: 'DatatableBrowseWidget HTML', live: true },
  { method: 'GET', path: '/pages/notices?archived=true', type: 'HTML', title: 'Archived notices', contract: 'Archive-filtered HTML list', live: true },
  { method: 'GET', path: '/pages/news', type: 'HTML', title: 'News', contract: 'DatatableBrowseWidget HTML', live: true },
  { method: 'GET', path: '/pages/tenders', type: 'HTML', title: 'Tenders', contract: 'DatatableBrowseWidget HTML', live: true },
  { method: 'GET', path: '/pages/jobs', type: 'HTML', title: 'Jobs', contract: 'DatatableBrowseWidget HTML', live: true },
  { method: 'GET', path: '/pages/reports', type: 'HTML', title: 'Reports', contract: 'DatatableBrowseWidget + report filters', live: true },
  { method: 'GET', path: '/pages/publications', type: 'HTML', title: 'Publications', contract: 'DatatableBrowseWidget HTML', live: true },
  { method: 'GET', path: '/pages/laws', type: 'HTML', title: 'Laws', contract: 'DatatableBrowseWidget + law fields', live: true },
  { method: 'GET', path: '/pages/policies', type: 'HTML', title: 'Policies', contract: 'DatatableBrowseWidget HTML', live: true },
  { method: 'GET', path: '/pages/annual-reports', type: 'HTML', title: 'Annual reports', contract: 'DatatableBrowseWidget HTML', live: true },
  { method: 'GET', path: '/pages/officers', type: 'HTML', title: 'Officers', contract: 'Officer directory HTML', live: true },
  { method: 'GET', path: '/views/info-officers', type: 'HTML', title: 'Information officers', contract: 'InfoOfficersViewWidget', live: true },
  { method: 'GET', path: '/pages/static-pages/695b97ffc4774958d7b70329', type: 'HTML', title: '2026 textbooks', contract: 'ContentViewerWidget + nested routes', live: true },
  { method: 'GET', path: '/pages/static-pages/695b9b7cc4774958d7b70a12', type: 'HTML', title: 'Primary textbook level', contract: 'ContentViewerWidget child links', live: true },
  { method: 'GET', path: '/pages/files/6922da22933eb65569e02aab', type: 'FILE', title: 'Regulations viewer', contract: 'HTML viewer with direct PDF URL', live: true },
  { method: 'GET', path: '/pages/organograms/6922d921933eb65569dfcead', type: 'HTML', title: 'Organogram', contract: 'ContentViewerWidget HTML', live: true },
  { method: 'GET', path: '/pages/web-forms/6922d3c481fc96cef9e9c017', type: 'HTML', title: 'Citizen feedback form', contract: 'Public web form HTML', live: true },
  { method: 'GET', path: '/site/officer_list/ad811fcf-dda0-487b-be24-6fd79e0d4eda', type: 'HTML', title: 'Officer directory', contract: 'ContentBrowseWidget + 250 rows', live: true },
  { method: 'GET', path: '/pages/{collection}', type: 'PATTERN', title: 'Collection list', contract: 'page, rows, filters, groupBy query params' },
  { method: 'GET', path: '/pages/{collection}/{slug}-{shortid}-{objectid}', type: 'PATTERN', title: 'Detail record', contract: 'Follow exact response link; do not construct slug' },
  { method: 'GET', path: '/pages/static-pages/{objectid}', type: 'PATTERN', title: 'Static page', contract: 'ContentViewerWidget; recursively exposes children' },
  { method: 'GET', path: '/pages/static-pages/{slug}-{shortid}-{objectid}', type: 'PATTERN', title: 'Slug static page', contract: 'Display-slug route form' },
  { method: 'GET', path: '/pages/files/{objectid}', type: 'PATTERN', title: 'File viewer', contract: 'HTML wrapper for object-storage file URL' },
  { method: 'GET', path: '/pages/organograms/{objectid}', type: 'PATTERN', title: 'Organogram record', contract: 'ContentViewerWidget HTML' },
  { method: 'GET', path: '/site/officer_list/{uuid}', type: 'PATTERN', title: 'Officer list', contract: 'Category, search, order, and page controls' },
  { method: 'GET', path: '/ajax/get/district/list?division_id={id}', type: 'PATTERN', title: 'District list', contract: 'Inferred cascading AJAX route' },
  { method: 'GET', path: '/ajax/get/upazila/list?district_id={id}', type: 'PATTERN', title: 'Upazila list', contract: 'Inferred cascading AJAX route' },
  { method: 'GET', path: 'https://objectstorage.ap-dcc-gazipur-1.oraclecloud15.com/n/{namespace}/b/{bucket}/o/office-nctb/{year}/{month}/{object-hash}.pdf', type: 'FILE', title: 'Object-storage download', contract: 'Extract complete URL; do not construct it' },
  { method: 'GET', path: '/site/page/{uuid}', type: 'PATTERN', title: 'Legacy site page', contract: 'One verified sitemap UUID returns 404' },
];

const BASE_URL = 'https://nctb.gov.bd';
const rowsElement = document.querySelector('#endpoint-rows');
const resultCount = document.querySelector('#result-count');
const metricCount = document.querySelector('#metric-count');
const emptyState = document.querySelector('#empty-state');
const toast = document.querySelector('#toast');
let toastTimer;

function toastMessage(text) {
  toast.textContent = text;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
}

function absolute(path) {
  return path.startsWith('https://') ? path : BASE_URL + path;
}

function render() {
  const query = document.querySelector('#search').value.trim().toLowerCase();
  const type = document.querySelector('input[name="type"]:checked').value;
  const filtered = endpoints.filter((endpoint) => {
    const haystack = [endpoint.path, endpoint.title, endpoint.contract, endpoint.type].join(' ').toLowerCase();
    return (!query || haystack.includes(query)) && (type === 'all' || endpoint.type === type);
  });

  rowsElement.replaceChildren(...filtered.map((endpoint) => {
    const row = document.createElement('tr');
    const methodCell = document.createElement('td');
    const method = document.createElement('span');
    method.className = 'method';
    method.textContent = endpoint.method;
    methodCell.append(method);

    const endpointCell = document.createElement('td');
    const link = document.createElement('a');
    link.className = 'endpoint';
    link.href = endpoint.live ? absolute(endpoint.path) : '#';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    const strong = document.createElement('strong');
    strong.textContent = endpoint.title;
    const code = document.createElement('span');
    code.textContent = endpoint.path;
    const note = document.createElement('small');
    note.textContent = endpoint.contract;
    link.append(strong, code, note);
    endpointCell.append(link);

    const typeCell = document.createElement('td');
    const pill = document.createElement('span');
    pill.className = `pill ${endpoint.type}`;
    pill.textContent = endpoint.type;
    typeCell.append(pill);

    const contractCell = document.createElement('td');
    contractCell.textContent = endpoint.contract;

    const actionCell = document.createElement('td');
    const actions = document.createElement('div');
    actions.className = 'row-actions';
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'action';
    copy.textContent = 'Copy URL';
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(absolute(endpoint.path));
        toastMessage('Absolute URL copied');
      } catch {
        toastMessage('Clipboard blocked by browser');
      }
    });

    if (endpoint.live) {
      const test = document.createElement('button');
      test.type = 'button';
      test.className = 'action';
      test.textContent = 'Test';
      const status = document.createElement('span');
      status.className = 'status';
      status.textContent = 'Browser test available';
      test.addEventListener('click', async () => {
        test.classList.add('busy');
        test.textContent = 'Testing…';
        status.textContent = 'Sending browser request…';
        const started = performance.now();
        try {
          const response = await fetch(absolute(endpoint.path), { mode: 'cors', cache: 'no-store' });
          const type = response.headers.get('content-type') || 'unknown';
          test.classList.add(response.ok ? 'ok' : 'fail');
          test.textContent = response.ok ? 'Pass' : 'Fail';
          status.textContent = `${response.status} ${type} · ${Math.round(performance.now() - started)} ms`;
        } catch {
          test.classList.add('blocked');
          test.textContent = 'CORS';
          status.textContent = 'Blocked by browser CORS; open URL directly';
        } finally {
          test.classList.remove('busy');
        }
      });
      actionCell.append(actions, status);
    } else {
      actionCell.append(actions);
    }

    actions.append(copy);
    row.append(methodCell, endpointCell, typeCell, contractCell, actionCell);
    return row;
  }));

  emptyState.hidden = filtered.length > 0;
  resultCount.textContent = `${filtered.length} of ${endpoints.length} catalog entries shown`;
}

document.querySelector('#filters').addEventListener('submit', (event) => event.preventDefault());
document.querySelector('#search').addEventListener('input', render);
document.querySelectorAll('input[name="type"]').forEach((input) => input.addEventListener('change', render));
document.querySelector('#clear').addEventListener('click', () => {
  document.querySelector('#search').value = '';
  document.querySelector('input[value="all"]').checked = true;
  render();
  document.querySelector('#search').focus();
});
render();
metricCount.textContent = String(endpoints.length);

