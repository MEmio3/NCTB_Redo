# NCTB API Documentation

**Base URL:** `https://nctb.gov.bd`

**Site:** National Curriculum and Textbook Board (NCTB), Bangladesh
**Bengali:** জাতীয় শিক্ষাক্রম ও পাঠ্যপুস্তক বোর্ড (এনসিটিবি)

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture & Infrastructure](#2-architecture--infrastructure)
3. [Authentication](#3-authentication)
4. [Rate Limiting & Caching](#4-rate-limiting--caching)
5. [Content Types](#5-content-types)
6. [Page Endpoints](#6-page-endpoints)
7. [AJAX / JSON API Endpoints](#7-ajax--json-api-endpoints)
8. [Dynamic Route Patterns](#8-dynamic-route-patterns)
9. [Filter & Query Parameters](#9-filter--query-parameters)
10. [Form Submissions](#10-form-submissions)
11. [File Download Endpoints](#11-file-download-endpoints)
12. [Static Asset Endpoints](#12-static-asset-endpoints)
13. [Widget System](#13-widget-system)
14. [External Linked Services](#14-external-linked-services)
15. [Complete Endpoint Catalog](#15-complete-endpoint-catalog)
16. [Content Body Encoding — the `<rt-renderer>` Mechanism](#16-content-body-encoding--the-rt-renderer-mechanism-critical-confirmed-2026-08-15)
17. [Appendix E: Connected Subpage API Reference](#appendix-e-connected-subpage-api-reference)
18. [Appendix F: Complete Nested Static-Page / File Catalog (355 routes)](#appendix-f-complete-nested-static-page--file-catalog-355-routes)
19. [Appendix G: Real Content Links (post-decode extraction)](#appendix-g-real-content-links-post-decode-extraction)

---

## 1. Overview

NCTB.gov.bd is a Bangladesh government portal built on the **National Portal Framework (NPF)** — a shared platform used across all `.gov.bd` sites. It is **not a REST API** in the traditional sense; it is a server-rendered web application with server-side routing, a small set of AJAX JSON endpoints, and form-based submission endpoints.

### Key Characteristics

| Property | Value |
|---|---|
| **Base URL** | `https://nctb.gov.bd` |
| **Protocol** | HTTPS (HSTS enabled) |
| **Rendering** | Server-side rendered (SSR) HTML |
| **Framework** | National Portal Framework (NPF) |
| **API Style** | Hybrid — HTML pages + select JSON AJAX endpoints |
| **Default Language** | Bengali (Bangla) |
| **Language Switching** | Automatic / cookie-based |
| **Caching** | Varnish 7.6 reverse proxy |

---

## 2. Architecture & Infrastructure

### Reverse Proxy / CDN

The site sits behind a **Varnish 7.6** caching layer operated by the Bangladesh government's cloud infrastructure.

**Infrastructure Headers (from every response):**

```
X-Obj-Host: nctb.gov.bd
X-Obj-Url: <requested-path>
X-Varnish: <id> <id>,<id>
X-Cache-Node: varnish-ministry-kube-httpcache-N
X-Cache: HIT | MISS
X-Cache-Hits: <count>
X-Cache-Lang: none
X-Entry-Node: varnish-ministry-kube-httpcache-N
Via: 1.1 varnish-ministry-kube-httpcache-N (Varnish/7.6), 1.1 varnish-ministry-kube-httpcache-N (Varnish/7.6)
Age: <seconds-since-cached>
```

### Security Headers

```
Content-Security-Policy: frame-src 'self' https://objectstorage...oraclecloud15.com https://www.googletagmanager.com https://www.youtube.com https://*.youtube.com http://*.youtube.com https://*.google.com https://www.facebook.com https://*.gov.bd http://*.gov.bd https://*.*.gov.bd http://*.*.gov.bd;
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
Origin-Agent-Cluster: ?1
Referrer-Policy: strict-origin-when-cross-origin
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
X-DNS-Prefetch-Control: off
X-Download-Options: noopen
X-Frame-Options: SAMEORIGIN
X-Permitted-Cross-Domain-Policies: none
X-XSS-Protection: 0
Permissions-Policy: camera=(self), microphone=(self), geolocation=(self "https://www.google.com" "https://google.com"), picture-in-picture=(self), fullscreen=*
```

### Object Storage

Static media/files are served from **Oracle Cloud Object Storage**:
- `https://objectstorage.ap-dcc-gazipur-1.oraclecloud15.com`
- Referenced in the Content-Security-Policy `frame-src` directive

### Analytics

Uses a **self-hosted Plausible Analytics** instance:
- `https://analytics-plausible.portal.gov.bd/js/script.file-downloads.hash.outbound-links.pageview-props.tagged-events.js`

---

## 3. Authentication

**The public site has no authentication.** All pages and the AJAX JSON endpoint are publicly accessible without login, tokens, or session cookies.

There are separate authenticated systems linked from the site:

| Service | URL | Purpose |
|---|---|---|
| **Webmail** | `http://mail.nctb.gov.bd/Login.aspx` | Staff email login |
| **APAMS** | `https://apams.cabinet.gov.bd/` | Annual Performance Agreement Management System |
| **PMS** | `https://pms.portal.gov.bd/office/outauth_new_office` | Performance Management System office auth |
| **iHealthScreen** | `https://nctb.ihealthscreen.org/` | Health screening portal |

These are **external services** and are not part of the NCTB portal API itself.

---

## 4. Rate Limiting & Caching

### Caching Strategy

All responses are cached at the **Varnish layer**. Key caching behaviors:

- **Cache Key:** Based on URL path + query parameters
- **Cache Hit:** `X-Cache: HIT` (response served from cache)
- **Cache Miss:** `X-Cache: MISS` (response fetched from origin)
- **Age Header:** Indicates how many seconds the cached response has been stored

### ETag Support

JSON endpoints return ETags for conditional requests:

```
ETag: W/"47a-/TgObfcEoJnvJ9kNzAvClyj/828"
```

Clients can use `If-None-Match` for conditional requests.

### Rate Limiting

No explicit rate limiting headers (no `X-RateLimit-*` headers) were observed. However, the Varnish cache layer naturally absorbs traffic spikes. Abuse would likely be handled at the network/infrastructure level.

---

## 5. Content Types

| Endpoint Pattern | Content-Type |
|---|---|
| `/pages/*` | `text/html; charset=utf-8` |
| `/views/*` | `text/html; charset=utf-8` |
| `/site/*` | `text/html; charset=utf-8` |
| `/ajax/get/*` | `application/json; charset=utf-8` |
| `/site-assets/*` | `text/css`, `application/javascript`, `image/*`, `font/*` |
| `/widget-assets/*` | `text/css` |
| `/assets/*` | `text/css`, `application/javascript` |

---

## 6. Page Endpoints

All page endpoints return **server-rendered HTML**. These are the primary content delivery routes.

### 6.1 Homepage

```
GET /
```

**Response:** `200 OK` | `text/html` | ~122 KB

Serves the homepage with:
- Banner slider
- Notice/news ticker
- Service boxes
- Important links
- Citizen services
- Emergency hotlines
- Photo gallery preview

---

### 6.2 Content Listing Pages

These pages display lists of content items with optional filtering.

| Endpoint | Description | Default Size |
|---|---|---|
| `GET /pages/notices` | Official notices (চলমান/active) | ~107 KB |
| `GET /pages/notices?archived=true` | Archived notices | ~110 KB |
| `GET /pages/news` | News articles | ~100 KB |
| `GET /pages/tenders` | Tender notices | ~92 KB |
| `GET /pages/jobs` | Job circulars | ~88 KB |
| `GET /pages/go-ultimates` | Government Orders (GOs) | ~107 KB |
| `GET /pages/reports` | Reports | ~105 KB |
| `GET /pages/publications` | Publications | ~95 KB |
| `GET /pages/laws` | Laws / acts | ~93 KB |
| `GET /pages/policies` | Policies | ~94 KB |
| `GET /pages/annual-reports` | Annual reports | ~101 KB |
| `GET /pages/external-links` | External resource links | ~93 KB |
| `GET /pages/officers` | Officer/directory listing | ~277 KB |

---

### 6.3 Content Detail Pages

Detail pages are accessed via slug-based URLs with embedded MongoDB ObjectId references.

#### Notice Detail

```
GET /pages/notices/{slug}-{shortid}-{objectid}
```

**Example:**
```
GET /pages/notices/জনাব-মোঃ-সাজেদুল-ওয়াহেদ-খান-এর-অফিসিয়াল-ই-পাসপোর্ট-করার-অনুমতি-সংক্রান্ত-অফিস-আদেশ-1648-8n89b0-6a7d7b5f424f283d36735be7
```

**URL Structure:**
- `{slug}` — Bengali title as URL slug
- `{shortid}` — Short alphanumeric ID (e.g., `8n89b0`)
- `{objectid}` — MongoDB ObjectId (e.g., `6a7d7b5f424f283d36735be7`)

#### News Detail

```
GET /pages/news/{slug}-{shortid}-{objectid}
```

**Example:**
```
GET /pages/news/পাঠ্যপুস্তক-মুদ্রণ-কাজে-দরপত্র-আহবানে-ই-জিপি-ব্যবহার-সংক্রান্ত-1066da-6922de0d933eb65569e17df8
```

#### Static Pages

```
GET /pages/static-pages/{objectid}
GET /pages/static-pages/{slug}-{shortid}-{objectid}
```

**Examples:**
```
GET /pages/static-pages/6922db65933eb65569e09ead
GET /pages/static-pages/ebtedayi-level-assessment-guidelines-2026-ezczi2-69f6fbff671bb4a704bb0f16
GET /pages/static-pages/primary-and-secondary-level-teachers-guide-list-for-the-academic-year-2026-c7wlhh-69afb72b7ce407d4d4fdd16e
GET /pages/static-pages/teacher-training-manuals-for-5-indigenous-languages-mxqyf7-6a44d5067f5592e6266752ca
```

---

### 6.4 Specialized Pages

| Endpoint | Description | Example ID |
|---|---|---|
| `GET /pages/photo-galleries/{objectid}` | Photo gallery album | `6922d8d681fc96cef9eaf123` |
| `GET /pages/organograms/{objectid}` | Organizational organogram | `6922d921933eb65569dfcead` |
| `GET /pages/web-forms/{objectid}` | Citizen web form (e.g., complaint/opinion) | `6922d3c481fc96cef9e9c017` |

---

### 6.5 Site Data Endpoints

These are `/site/` routes that return HTML pages with structured data.

| Endpoint | Description |
|---|---|
| `GET /site/officer_list/{uuid}` | Officer list / organizational directory |
| `GET /site/page/{uuid}` | Generic site page by UUID |

**Examples:**
```
GET /site/officer_list/ad811fcf-dda0-487b-be24-6fd79e0d4eda
GET /site/page/b543ab16-f60a-4e9f-a621-93b69b6c61cf
```

> **Note:** `/site/page/{uuid}` returned **404** for the UUID discovered on the homepage. This may be a dynamically-generated link that requires session context or is deprecated.

---

### 6.6 View Endpoints

These `/views/` routes render specialized HTML views.

| Endpoint | Description | Response Size |
|---|---|---|
| `GET /views/sitemap` | HTML sitemap of all pages | ~106 KB |
| `GET /views/sps-data` | SPS (Single Page Site) data view | ~92 KB |
| `GET /views/info-officers` | Information officers listing | ~86 KB |

---

## 7. AJAX / JSON API Endpoints

These are the only endpoints that return **JSON data** programmatically. They are used by the frontend JavaScript for dynamic dropdowns.

### 7.1 Get Division List

```
GET /ajax/get/division/list
```

**Response:** `200 OK` | `application/json; charset=utf-8` | 1,146 bytes

Returns all 8 divisions of Bangladesh.

**Response Body:**
```json
[
  {
    "_id": "66648869fbd77af96fdf18a1",
    "bbs_code": 10,
    "id": 1,
    "title": "Barisal",
    "title_bn": "বরিশাল",
    "title_en": "Barisal",
    "row_status": 1
  },
  {
    "_id": "66648869fbd77af96fdf18a2",
    "bbs_code": 20,
    "id": 2,
    "title": "Chittagong",
    "title_bn": "চট্টগ্রাম",
    "title_en": "Chittagong",
    "row_status": 1
  },
  {
    "_id": "66648869fbd77af96fdf18a3",
    "bbs_code": 30,
    "id": 3,
    "title": "Dhaka",
    "title_bn": "ঢাকা",
    "title_en": "Dhaka",
    "row_status": 1
  },
  {
    "_id": "66648869fbd77af96fdf18a4",
    "bbs_code": 40,
    "id": 4,
    "title": "Khulna",
    "title_bn": "খুলনা",
    "title_en": "Khulna",
    "row_status": 1
  },
  {
    "_id": "66648869fbd77af96fdf18a5",
    "bbs_code": 50,
    "id": 5,
    "title": "Rajshahi",
    "title_bn": "রাজশাহী",
    "title_en": "Rajshahi",
    "row_status": 1
  },
  {
    "_id": "66648869fbd77af96fdf18a6",
    "bbs_code": 55,
    "id": 6,
    "title": "Rangpur",
    "title_bn": "রংপুর",
    "title_en": "Rangpur",
    "row_status": 1
  },
  {
    "_id": "66648869fbd77af96fdf18a7",
    "bbs_code": 70,
    "id": 7,
    "title": "Sylhet",
    "title_bn": "সিলেট",
    "title_en": "Sylhet",
    "row_status": 1
  },
  {
    "_id": "66648869fbd77af96fdf18a8",
    "bbs_code": 45,
    "id": 8,
    "title": "Mymensingh",
    "title_bn": "ময়মনসিংহ",
    "title_en": "Mymensingh",
    "row_status": 1
  }
]
```

**Field Reference:**

| Field | Type | Description |
|---|---|---|
| `_id` | string | MongoDB ObjectId |
| `bbs_code` | number | Bangladesh Bureau of Statistics code |
| `id` | number | Sequential numeric ID |
| `title` | string | English title (legacy) |
| `title_bn` | string | Bengali title |
| `title_en` | string | English title |
| `row_status` | number | Active flag (1 = active) |

### 7.2 Office-Selector Cascading Endpoints (Confirmed, corrected 2026-08-15)

The earlier version of this document guessed `/ajax/get/district/list` and `/ajax/get/upazila/list` from the generic NPF pattern; both returned 404 because that guess was wrong. Live network capture on `OfficeFindThreeWidget` (the "office type" selector present in the header of every page) shows the real, confirmed contract:

```http
GET /ajax/get/office-type/{office_type_id}/levels
GET /ajax/get/office-level/{level_id}/offices?office_type_id={office_type_id}
```

**Example (captured live):**
```http
GET /ajax/get/office-type/6915c8c02d68425160fc40f1/levels
→ 200 OK, application/json
[{"_id":"626a41e552093d4768e64b10","code":"head_office","title_bn":"প্রধান কার্যালয়","title_en":"Head Office","sort_order":2,"is_geo_level":0}]

GET /ajax/get/office-level/626a41e552093d4768e64b10/offices?office_type_id=6915c8c02d68425160fc40f1
→ 200 OK, application/json
[{"_id":"...","subdomain":"bjwt.gov.bd","title_bn":"বাংলাদেশ সাংবাদিক কল্যাণ ট্রাস্ট","title_en":"Bangladesh Journalist Welfare Trust","domain":"bjwt.gov.bd", ...}, ...]
```

This endpoint pair returns the **entire national office directory** (thousands of `.gov.bd` offices, not NCTB-specific) that populates the "office type" mega-dropdown shared across every National Portal Framework site — it is generic NPF infrastructure, not an NCTB content endpoint. The division list (`/ajax/get/division/list`, §7.1) remains the only NCTB-content-relevant JSON endpoint; district/upazila cascades were never real — that assumption is retired.

---

## 8. Dynamic Route Patterns

The site uses several URL patterns with embedded identifiers:

### Pattern 1: ObjectId Routes
```
/pages/static-pages/{mongodb_objectid}
/pages/photo-galleries/{mongodb_objectid}
/pages/organograms/{mongodb_objectid}
/pages/web-forms/{mongodb_objectid}
/pages/files/{mongodb_objectid}
```

### Pattern 2: Slug + Short ID + ObjectId Routes
```
/pages/{type}/{bengali-slug}-{shortid}-{mongodb_objectid}
```

Components:
- `{bengali-slug}` — URL-safe transliteration of the Bengali title
- `{shortid}` — 6-character base36 ID (e.g., `8n89b0`, `rmo93v`)
- `{mongodb_objectid}` — 24-character hex MongoDB ObjectId

### Pattern 3: UUID Routes
```
/site/officer_list/{uuid}
/site/page/{uuid}
```

### Pattern 4: Query-Filter Routes
```
/pages/{type}?filters={url_encoded_json}
```

---

## 9. Filter & Query Parameters

### 9.1 JSON-Based Filters

Several listing pages accept filters via URL-encoded JSON in the `filters` query parameter.

#### Government Orders (GO) by Order Type
```
GET /pages/go-ultimates?filters={"order":"{category_objectid}"}
```

**URL-Encoded Example:**
```
GET /pages/go-ultimates?filters=%7B%22order%22%3A%20%226922d29c81fc96cef9e995e1%22%7D
GET /pages/go-ultimates?filters=%7B%22order%22%3A%20%226922d29e81fc96cef9e9970d%22%7D
GET /pages/go-ultimates?filters=%7B%22order%22%3A%20%226922d29e81fc96cef9e9972f%22%7D
```

#### Officers by Category
```
GET /pages/officers?filters={"officer_category":"{category_objectid}"}
```

**URL-Encoded Example:**
```
GET /pages/officers?filters=%7B%22officer_category%22%3A%20%226922d2bd81fc96cef9e9a38a%22%7D
```

#### Reports by Type
```
GET /pages/reports?filters={"reports_type":"{type_objectid}"}
```

**URL-Encoded Example:**
```
GET /pages/reports?filters=%7B%22reports_type%22%3A%20%226922d2a781fc96cef9e99b31%22%7D
```

### 9.2 Boolean Query Parameters
```
GET /pages/notices?archived=true
```

Switches between active and archived notice listings.

### 9.3 Search Query Parameter
```
GET ?key={search_term}
```

The global search widget uses a `key` parameter. Search is triggered via JavaScript handlers (`handleSearchEnter`, `handleSearchClick`) that navigate to a search results page.

---

## 10. Form Submissions

### 10.1 Citizen Opinion / Feedback Form

**Found on:** `/pages/web-forms/{objectid}`
**Example:** `/pages/web-forms/6922d3c481fc96cef9e9c017`

This is the citizen engagement web form (মতামত প্রদান / opinion submission).

**Form HTML:**
```html
<form class="web-form-widget-form" enctype="multipart/form-data">
```

**Fields:**

| Field Name (HTML) | Bengali Label | Type | Required |
|---|---|---|---|
| `মতামত_প্রদানকারীর_নাম` | Submitter Name | text | Yes |
| `মতামত_প্রদানকারীর_মোবাইল` | Submitter Mobile | tel | Yes |
| `মতামত_প্রদানকারীর_ই_মেইল` | Submitter Email | email | Yes |
| `মতামত_প্রদানকারীর_ঠিকানা` | Submitter Address | textarea | Yes |
| `বিষয়` | Subject | text/select | Yes |
| `মতামত_পরামর্শ` | Opinion/Suggestion | textarea | Yes |
| `attachment` | File Attachment | file | No |
| `web_form_id` | Form ID (hidden) | hidden | Yes |
| `officeType` | Office Type (hidden) | hidden | Yes |

> **Note:** The form has no explicit `action` or `method` attribute in the HTML. Submission is handled via JavaScript (fetch/XHR) to a backend endpoint. The `enctype="multipart/form-data"` confirms it supports file uploads.

### 10.2 Opinion Poll Form

**Found on:** Multiple pages (footer/sidebar widget)

```html
<form id="opinionForm" class="opinion-form" enctype="multipart/form-data">
```

**Fields:**

| Field Name | Label | Type |
|---|---|---|
| `name` | Name | text |
| `email` | Email | email |
| `phone` | Phone | tel |
| `opinionType` | Opinion Type | select |
| `body` | Opinion Body | textarea |
| `attachment` | Attachment | file |
| `key` | Key (hidden) | hidden |
| `lang` | Language (hidden) | hidden |

---

## 11. File Download Endpoints

### 11.1 File Viewer/Download Page

```
GET /pages/files/{mongodb_objectid}
```

Returns an HTML page that serves/displays the file. Each file has a unique ObjectId.

**Confirmed File IDs from the site:**

| File ID | Found On |
|---|---|
| `6922d9d5933eb65569e00751` | Homepage downloads |
| `6922d9f6933eb65569e015ea` | Homepage downloads |
| `6922da05933eb65569e01e28` | Homepage downloads |
| `6922da22933eb65569e02aab` | Homepage downloads |
| `6922da95933eb65569e05824` | Homepage downloads |
| `6922db5b933eb65569e09a2c` | Homepage downloads |
| `6922dbc6933eb65569e0c702` | Homepage downloads |
| `6922dbd3933eb65569e0cd02` | Homepage downloads |

**Example:**
```
GET /pages/files/6922d9d5933eb65569e00751
```
**Response:** `200 OK` | `text/html` | ~89 KB

### 11.2 Static File Downloads

The site also links directly to downloadable files hosted externally:

```
https://www.nvaccess.org/files/nvda/releases/2020.4/nvda_2020.4.exe
```
NVDA screen reader download (accessibility tool).

---

## 12. Static Asset Endpoints

### 12.1 Site Assets

| Path Pattern | Content-Type | Description |
|---|---|---|
| `/site-assets/css/index.css` | text/css | Main stylesheet |
| `/site-assets/css/phosphor.css` | text/css | Phosphor icon styles |
| `/site-assets/css/phosphor-fill.css` | text/css | Phosphor filled icon styles |
| `/site-assets/js/index.js` | application/javascript | Main JS bundle (31 KB) |
| `/site-assets/images/favicon.ico` | image/x-icon | Favicon |
| `/site-assets/images/favicon.png` | image/png | Favicon (PNG) |
| `/site-assets/images/portal_banner.jpg` | image/jpeg | OG image / portal banner |
| `/site-assets/images/right-tick.png` | image/png | UI checkmark icon |
| `/site-assets/fonts/kalpurush.ttf` | font/ttf | Bengali font |
| `/site-assets/fonts/BenSenHandwriting.ttf` | font/ttf | Bengali handwriting font |
| `/site-assets/fonts/Roboto-Regular.ttf` | font/ttf | English font |

### 12.2 Theme Assets

| Path | Description |
|---|---|
| `/assets/css/index.css` | Theme-specific CSS |
| `/assets/js/index.js` | Theme bootstrap JS (295 bytes — minimal config) |

### 12.3 Widget Assets

Each widget has its own CSS bundle under `/widget-assets/css/`:

```
/widget-assets/css/AccessibilityWidget
/widget-assets/css/BannerSliderImageWidget
/widget-assets/css/BdWorkersTrustBoardImageLinkWidget
/widget-assets/css/BlockWidget
/widget-assets/css/CentralBlocksSidebarWidget
/widget-assets/css/discount
/widget-assets/css/EmergencyHotlineListCardWidget
/widget-assets/css/FooterWidget
/widget-assets/css/GlobalSearchWidget
/widget-assets/css/GoToTopWidget
/widget-assets/css/HeaderWidget
/widget-assets/css/ImportantLinkCardWidget
/widget-assets/css/LanguageSwitcherWidget
/widget-assets/css/MenusExpandableWidget
/widget-assets/css/MenusWidget
/widget-assets/css/MyGovServiceImageLinkWidget
/widget-assets/css/NationalAnthemWidget
/widget-assets/css/NoticeNewsCardWidget
/widget-assets/css/OfficeAttachmentApplicationFormWidget
/widget-assets/css/OfficeDigitalServiceImageLinkWidget
/widget-assets/css/OfficeFindThreeWidget
/widget-assets/css/popup
/widget-assets/css/ServiceBoxExpandableStackWidget
/widget-assets/css/ServiceBoxStackWidget
/widget-assets/css/ServiceBoxWidget
/widget-assets/css/TopNewsCardWidget
```

**Confirmed via live network capture on content-detail pages (2026-08-15), missing from the original list:**

```
/widget-assets/css/ContentViewerWidget
/widget-assets/css/ContentDetailsWidget
/widget-assets/css/TitleWithImageContentWidget
/widget-assets/css/PrintWidget
/widget-assets/css/SocialContentShareWidget
/widget-assets/css/EParticipationOpinionPopupWidget
/widget-assets/css/EParticipationOpinionFormWidget
```
Each has a matching `/widget-assets/js/{WidgetName}` bundle, same as the widgets listed above.

---

## 13. Widget System

The NCTB portal is composed of modular **widgets**. Each page assembles widgets to build the layout. Key widgets discovered:

| Widget | Purpose |
|---|---|
| **HeaderWidget** | Site header with logo, navigation |
| **MenusWidget** / **MenusExpandableWidget** | Navigation menus |
| **GlobalSearchWidget** | Global site search bar |
| **LanguageSwitcherWidget** | Bengali/English language toggle |
| **BannerSliderImageWidget** | Homepage banner carousel |
| **NoticeNewsCardWidget** | Notice & news card display |
| **TopNewsCardWidget** | Top/breaking news ticker |
| **ServiceBoxWidget** / **ServiceBoxStackWidget** / **ServiceBoxExpandableStackWidget** | Citizen service quick-links |
| **BlockWidget** | Content block renderer |
| **CentralBlocksSidebarWidget** | Sidebar content blocks |
| **EmergencyHotlineListCardWidget** | Emergency contact numbers |
| **ImportantLinkCardWidget** | Important external links |
| **OfficeAttachmentApplicationFormWidget** | Office attachment application |
| **OfficeDigitalServiceImageLinkWidget** | Digital service links |
| **OfficeFindThreeWidget** | Office finder |
| **MyGovServiceImageLinkWidget** | myGov service links |
| **BdWorkersTrustBoardImageLinkWidget** | Workers welfare trust link |
| **NationalAnthemWidget** | National anthem player |
| **AccessibilityWidget** | Screen reader / accessibility tools |
| **GoToTopWidget** | Scroll-to-top button |
| **FooterWidget** | Site footer |
| **Popup** | Popup/modal overlay |
| **ContentViewerWidget** | Renders one content record (title, timestamp, body). The body itself is inside a nested `<rt-renderer>` element — see §16 |
| **ContentDetailsWidget** | Bundled site-wide; renders structured metadata fields alongside a content record |
| **TitleWithImageContentWidget** | Renders a content record's heading/hero-image block inside `ContentViewerWidget` |
| **PrintWidget** | "Print this page" control (`window._print_content(this)`) |
| **SocialContentShareWidget** | Share-this-content button/menu |
| **EParticipationOpinionPopupWidget** / **EParticipationOpinionFormWidget** | The public opinion/feedback popup and its form (see §10.2) |

### Global Search Handler

The search widget exposes two JavaScript functions on `window`:

```javascript
window.handleSearchEnter(inputId, event)   // Triggered on Enter keypress
window.handleSearchClick(inputId)           // Triggered on search button click
```

The search input has `name="key"` and a numeric ID. The handlers construct a search URL and navigate to it.

---

## 14. External Linked Services

The NCTB site links to these external government/international services:

| Service | URL |
|---|---|
| Bangladesh National Portal | `https://bangladesh.gov.bd/` |
| National Portal (alt) | `http://bangladesh.gov.bd` |
| Directorate of Primary Education | `https://dpe.gov.bd/` |
| Directorate of Secondary & Higher Education | `https://dshe.gov.bd/` |
| Ministry of Education | `https://mopa.gov.bd/pages/mopa-report-publication?filters=%7B%22go_type%22%3A%20%22694137eda31054345f0e5bdb%22%7D` |
| Science and Technology Ministry | `https://shed.gov.bd/` |
| Technical & Madrasa Education Division | `https://tmed.gov.bd` |
| Ministry of Information & Communication | `https://infocom.gov.bd/` |
| Cabinet Division | `https://cabinet.gov.bd/index.php?lang=bn` |
| APAMS (Cabinet) | `https://apams.cabinet.gov.bd/` |
| BKKB | `https://bkkb.portal.gov.bd/` |
| PMS Portal | `https://pms.portal.gov.bd/office/outauth_new_office` |
| eDirectory | `https://edirectory.portal.gov.bd/` |
| Grievance Redress System | `http://www.grs.gov.bd/` |
| myGov | `https://www.mygov.bd/` |
| NCTB iHealthScreen | `https://nctb.ihealthscreen.org/` |
| Digital Content (ICTD) | `http://digitalcontent.ictd.gov.bd/` |
| NVDA Screen Reader | `https://www.nvaccess.org/files/nvda/releases/2020.4/nvda_2020.4.exe` |
| NCTB Webmail | `http://mail.nctb.gov.bd/Login.aspx` |
| Bangladesh Gov Portal Page | `https://bangladesh.gov.bd/site/page/aaebba14-f52a-4a3d-98fd-a3f8b911d3d9` |

---

## 15. Complete Endpoint Catalog

### Master Endpoint Reference Table

| # | Method | Endpoint | Content-Type | Status | Description |
|---|---|---|---|---|---|
| 1 | GET | `/` | text/html | 200 | Homepage |
| 2 | GET | `/pages/notices` | text/html | 200 | Active notices list |
| 3 | GET | `/pages/notices?archived=true` | text/html | 200 | Archived notices list |
| 4 | GET | `/pages/notices/{slug}-{shortid}-{id}` | text/html | 200 | Notice detail page |
| 5 | GET | `/pages/news` | text/html | 200 | News list |
| 6 | GET | `/pages/news/` | text/html | 200 | News list (trailing slash) |
| 7 | GET | `/pages/news/{slug}-{shortid}-{id}` | text/html | 200 | News detail page |
| 8 | GET | `/pages/tenders` | text/html | 200 | Tenders list |
| 9 | GET | `/pages/jobs` | text/html | 200 | Jobs list |
| 10 | GET | `/pages/go-ultimates` | text/html | 200 | Government Orders list |
| 11 | GET | `/pages/go-ultimates?filters={json}` | text/html | 200 | GOs filtered by order type |
| 12 | GET | `/pages/reports` | text/html | 200 | Reports list |
| 13 | GET | `/pages/reports?filters={json}` | text/html | 200 | Reports filtered by type |
| 14 | GET | `/pages/publications` | text/html | 200 | Publications list |
| 15 | GET | `/pages/laws` | text/html | 200 | Laws list |
| 16 | GET | `/pages/policies` | text/html | 200 | Policies list |
| 17 | GET | `/pages/annual-reports` | text/html | 200 | Annual reports list |
| 18 | GET | `/pages/external-links` | text/html | 200 | External links page |
| 19 | GET | `/pages/officers` | text/html | 200 | Officers/directory listing |
| 20 | GET | `/pages/officers?filters={json}` | text/html | 200 | Officers filtered by category |
| 21 | GET | `/pages/static-pages/{objectid}` | text/html | 200 | Static content page |
| 22 | GET | `/pages/static-pages/{slug}-{shortid}-{id}` | text/html | 200 | Static content page (slug) |
| 23 | GET | `/pages/photo-galleries/{objectid}` | text/html | 200 | Photo gallery album |
| 24 | GET | `/pages/organograms/{objectid}` | text/html | 200 | Organogram view |
| 25 | GET | `/pages/web-forms/{objectid}` | text/html | 200 | Citizen web form |
| 26 | GET | `/pages/files/{objectid}` | text/html | 200 | File viewer/download page |
| 27 | GET | `/site/officer_list/{uuid}` | text/html | 200 | Officer list by UUID |
| 28 | GET | `/site/page/{uuid}` | text/html | 200* | Generic site page |
| 29 | GET | `/views/sitemap` | text/html | 200 | HTML sitemap |
| 30 | GET | `/views/sps-data` | text/html | 200 | SPS data view |
| 31 | GET | `/views/info-officers` | text/html | 200 | Information officers view |
| 32 | GET | `/ajax/get/division/list` | application/json | 200 | All divisions (JSON) |
| 33 | GET | `/assets/css/index.css` | text/css | 200 | Theme CSS |
| 34 | GET | `/assets/js/index.js` | application/javascript | 200 | Theme bootstrap JS |
| 35 | GET | `/site-assets/css/index.css` | text/css | 200 | Main stylesheet |
| 36 | GET | `/site-assets/css/phosphor.css` | text/css | 200 | Icon CSS |
| 37 | GET | `/site-assets/css/phosphor-fill.css` | text/css | 200 | Filled icon CSS |
| 38 | GET | `/site-assets/js/index.js` | application/javascript | 200 | Main JS bundle |
| 39 | GET | `/site-assets/images/favicon.ico` | image/x-icon | 200 | Favicon |
| 40 | GET | `/site-assets/images/favicon.png` | image/png | 200 | Favicon PNG |
| 41 | GET | `/site-assets/images/portal_banner.jpg` | image/jpeg | 200 | OG image |
| 42 | GET | `/site-assets/fonts/kalpurush.ttf` | font/ttf | 200 | Bengali font |
| 43 | GET | `/site-assets/fonts/BenSenHandwriting.ttf` | font/ttf | 200 | Bengali font |
| 44 | GET | `/site-assets/fonts/Roboto-Regular.ttf` | font/ttf | 200 | English font |
| 45 | GET | `/widget-assets/css/{WidgetName}` | text/css | 200 | Widget CSS bundles |
| 46 | POST | (web form submission) | multipart/form-data | - | Citizen opinion/feedback |
| 47 | POST | (opinion poll submission) | multipart/form-data | - | Opinion poll submission |

> `*` = `/site/page/{uuid}` returned 404 for the probed UUID; may require session context.

### Endpoints That Return 404 (Not Found)

| Endpoint | Notes |
|---|---|
| `/robots.txt` | Not configured |
| `/sitemap.xml` | No XML sitemap (use `/views/sitemap` for HTML) |
| `/api` | No `/api` prefix exists |
| `/api/v1` | No versioned API |
| `/pages/search?key=...` | Search uses different routing |
| `/pages/service-boxes` | Not a standalone page (widget-only) |
| `/ajax/get/district/list` | Wrong guess, retired — real contract is `/ajax/get/office-type/{id}/levels` and `/ajax/get/office-level/{id}/offices`, see §7.2 |
| `/ajax/get/upazila/list` | Same — see §7.2 |

---

## 16. Content Body Encoding — the `<rt-renderer>` Mechanism (critical, confirmed 2026-08-15)

**This is the single most important fact for programmatically reading real content off this site, and it was missing from every earlier version of this document.** It is also why a plain-HTML fetch of any `ContentViewerWidget` page — including a naive scrape of the "Class 1 textbook" page — looks empty even when it isn't.

### 16.1 The problem

`ContentViewerWidget` (used by every `/pages/static-pages/*`, `/pages/{collection}/{slug}` detail page, etc.) does **not** put its rich-text body — the actual paragraphs, tables, and `<a href>` download links an editor typed in — directly into the page's HTML as ordinary markup. Instead the body is serialized and placed inside a single custom element:

```html
<rt-renderer encoded-content="BASE64_STRING"></rt-renderer>
```

`encoded-content` is the real body HTML, **base64-encoded**. A plain `fetch()` + `querySelectorAll('a')` — or any scraper that doesn't know this — sees `<rt-renderer>` as an opaque, childless element and concludes the page has no body and no links. That is exactly what happened on `/pages/static-pages/695b9adec4774958d7b708cd` ("2026 academic year, Class 1, primary-level textbooks"): it *looks* empty by every naive check, but decoding `encoded-content` reveals a full table of book names with real Google Drive / `drive.egovcloud.gov.bd` download links.

### 16.2 The fix — decode before you extract

```javascript
// In a browser / any JS runtime with atob():
const el = document.querySelector('rt-renderer');
const html = decodeURIComponent(escape(atob(el.getAttribute('encoded-content'))));
// html is now ordinary markup — parse it and pull <a href> as usual.
```

```python
# Server-side / no atob():
import base64
html = base64.b64decode(encoded_content_attr).decode('utf-8')
```

A page can contain more than one `<rt-renderer>` (e.g. `ContentViewerWidget` plus a nested widget); decode and scan all of them.

### 16.3 Impact on this document's earlier crawl

The 355-page recursive catalog in **[Appendix F](#appendix-f-complete-nested-static-page--file-catalog-355-routes)** (`nested_routes_catalog.json`) *did* correctly decode `encoded-content` to discover nested `/pages/static-pages/{id}` links — that part worked. What it explicitly did **not** do (per its own Discovery Contract, step 3: "Extract every returned `/pages/static-pages/{objectid}` link") was capture any other link type found inside that decoded HTML — meaning every external download link (Google Drive, `drive.egovcloud.gov.bd`, Oracle Object Storage PDFs) on all 355 pages was silently discarded. That is the gap the user found when a book-download attempt against this catalog turned up nothing.

**This has now been corrected — see [Appendix G](#appendix-g-real-content-links-post-decode-extraction) for the full re-extraction (260 of 355 pages carry real external links; 3,092 links total) and the actual Class 1 textbook download links.**

---

## Appendix A: Static Page Catalog

The following static pages were discovered on the site. Each is accessible at `/pages/static-pages/{id}`:

### Core Static Pages

| ID | Content Area |
|---|---|
| `6922db65933eb65569e09ead` | Introduction/Overview |
| `6922db84933eb65569e0a912` | History |
| `6922dba5933eb65569e0b892` | Functions/Responsibilities |
| `6922dbc9933eb65569e0c85a` | Organizational structure |
| `6922dbcc933eb65569e0c9e3` | Vision/Mission |
| `6922dc46933eb65569e0f6b6` | Curriculum details |
| `6922dc50933eb65569e0fa9f` | Syllabus information |

### Curriculum & Education Static Pages

| ID | Content Area |
|---|---|
| `6922dcb2933eb65569e1196c` | Primary curriculum |
| `6922dcd3933eb65569e12431` | Secondary curriculum |
| `6922dce3933eb65569e12943` | Higher secondary curriculum |
| `6922dcf3933eb65569e12e58` | Madrasa curriculum |
| `6922dd0b933eb65569e13492` | Technical curriculum |
| `6922dd35933eb65569e13f12` | Assessment guidelines |
| `6922dd6c933eb65569e14fcc` | Teacher guides |
| `6922dd7f933eb65569e15431` | Training materials |
| `6922dda1933eb65569e15b1d` | Digital content |
| `6922ddf7933eb65569e175ae` | E-learning resources |
| `6922ddfc933eb65569e1775c` | Multimedia talking books |

### Additional Static Pages

| ID | Content Area |
|---|---|
| `6922de0c933eb65569e17d88` | Textbook distribution |
| `6922de1d933eb65569e185c0` | Free textbook program |
| `6922de33933eb65569e18f7c` | Textbook festival |
| `6922de68933eb65569e1a70c` | Quality assurance |
| `6922de6d933eb65569e1a907` | Printing standards |
| `6922de84933eb65569e1b39f` | Research & development |
| `6922de8f933eb65569e1b977` | Publications archive |
| `6922de8f933eb65569e1b98b` | Newsletter |
| `6922de91933eb65569e1ba7a` | Annual report archive |
| `6922dee4933eb65569e1e2b6` | Citizen charter |
| `6922def2933eb65569e1ea1c` | RTI (Right to Information) |
| `6922df0b933eb65569e1f705` | Contact information |
| `6922df2c933eb65569e20586` | Grievance redress |
| `6922df35933eb65569e20953` | eServices |
| `6922df54933eb65569e213f7` | Accessibility |
| `6922df5e933eb65569e21861` | Privacy policy |
| `6922df64933eb65569e21ab2` | Terms of use |
| `6922df78933eb65569e22328` | FAQ |
| `6922dfc9933eb65569e23fcb` | Archive - old curricula |
| `6922dfd2933eb65569e2429b` | Archive - old textbooks |
| `6922dfd9933eb65569e244f5` | Archive - old syllabi |
| `6922dfe0933eb65569e2473b` | Archive - old policies |
| `6922dff5933eb65569e24d31` | Indigenous language books |
| `6922dffa933eb65569e24e81` | Braille textbooks |
| `6922dffd933eb65569e24f40` | Special needs materials |
| `6922e00e933eb65569e253c7` | Teacher diary |
| `6922e03f933eb65569e26306` | Evaluation guidelines (primary) |
| `6922e04d933eb65569e26653` | IDT and e-Learning |
| `6922e06b933eb65569e26f64` | Digitization program |
| `6922e072933eb65569e2718c` | Multimedia talking books |
| `6922e07b933eb65569e2744c` | Teacher support |
| `6922e097933eb65569e27ba4` | Teacher support archive |
| `6922e09d933eb65569e27d8c` | Assessment archive |
| `6922e0cf933eb65569e28a8d` | Human resources |
| `6922e0d7933eb65569e28cf0` | Budget & finance |
| `6922e109933eb65569e29c11` | Procurement |
| `6922e133933eb65569e2ad74` | Projects |
| `6922e136933eb65569e2ae72` | International cooperation |
| `6922e144933eb65569e2b330` | Awards & recognition |
| `695b97ffc4774958d7b70329` | (Added later) |
| `6988638a3121d2f262f0eab3` | (Added later) |

### Slug-Based Static Pages

| Slug | ID |
|---|---|
| `ebtedayi-level-assessment-guidelines-2026` | `69f6fbff671bb4a704bb0f16` |
| `primary-and-secondary-level-teachers-guide-list-for-the-academic-year-2026` | `69afb72b7ce407d4d4fdd16e` |
| `teacher-training-manuals-for-5-indigenous-languages` | `6a44d5067f5592e6266752ca` |

---

## Appendix B: Embedded Data — Emergency Hotlines

The homepage embeds hotline data as a JSON array in an inline script. Sample structure:

```json
[
  {
    "title_en": "Government information and services",
    "title_bn": "সরকারি তথ্য ও সেবা",
    "phone_number_en": "333",
    "phone_number_bn": "৩৩৩"
  }
]
```

This is **not an API endpoint** — it is pre-rendered server data embedded in the HTML for the `EmergencyHotlineListCardWidget`.

---

## Appendix C: HTTP Methods Summary

| Method | Usage |
|---|---|
| `GET` | All page views, AJAX data fetch, static assets, file downloads |
| `POST` | Form submissions (opinion form, web form) — via JavaScript fetch |
| `HEAD` | Supported (tested on file endpoints) |
| `PUT` / `DELETE` / `PATCH` | Not used (no public write API) |

---

## Appendix D: Language / Localization

- **Primary language:** Bengali (Bangla)
- **Secondary language:** English
- **Language switching** is handled via the `LanguageSwitcherWidget`
- The `X-Cache-Lang: none` header suggests language is determined client-side or via cookie
- AJAX responses include both `title_bn` and `title_en` fields for bilingual support

---

*Documentation generated on 2026-08-14 by analyzing `https://nctb.gov.bd/`*

*Disclaimer: This documentation was created by probing publicly accessible endpoints. Form POST endpoints were not actually submitted to avoid creating test data on a government website. Some endpoints (cascading location AJAX) are inferred from the framework pattern but returned 404 on direct access — they may require specific page context or session state.*

---

# Appendix E: Connected Subpage API Reference

Verified against the public NCTB homepage and HTML sitemap on **2026-08-14**. Unless stated otherwise, endpoints return `200 OK`, `text/html; charset=utf-8`, and require no authentication. URL-encode Bangla text and JSON query values.

## E.1 Subpage Route Families

| Route family | Response contract | Purpose |
|---|---|---|
| `GET /pages/{collection}` | `DatatableBrowseWidget` or `ContentBrowseWidget` HTML | Paginated collection and linked detail records |
| `GET /pages/{collection}/{slug}-{shortid}-{objectid}` | `ContentViewerWidget` HTML | One content record, metadata, body, and attachments |
| `GET /pages/static-pages/{objectid}` | `ContentViewerWidget` HTML | Static/nested page and child links |
| `GET /pages/static-pages/{slug}-{shortid}-{objectid}` | `ContentViewerWidget` HTML | Static page addressed by display slug |
| `GET /pages/files/{objectid}` | `ContentViewerWidget` HTML | File metadata, preview, and direct object-storage links |
| `GET /pages/organograms/{objectid}` | `ContentViewerWidget` HTML | Organization-chart record |
| `GET /pages/officers/{slug}-{shortid}-{objectid}` | `ContentViewerWidget` HTML | Officer profile |
| `GET /site/officer_list/{uuid}` | `ContentBrowseWidget` HTML | Full officer directory and controls |
| `GET /views/info-officers` | `InfoOfficersViewWidget` HTML | Information-officer directory |
| `GET /views/sitemap` | `SiteMapViewWidget` HTML | Current published navigation tree |

These are HTML APIs, not JSON collection APIs. Parse the relevant widget rather than the full page shell, and follow returned links exactly; slugs are display-oriented, not stable keys.

## E.2 Shared Detail-Route Contract

```http
GET /pages/{collection}/{slug}-{shortid}-{objectid}
```

| Segment | Observed format | Meaning |
|---|---|---|
| `{collection}` | route name | Content family such as `reports`, `laws`, or `officers` |
| `{slug}` | URL-encoded Bangla/English | Title-derived display slug; may be empty |
| `{shortid}` | usually six characters | Short identifier |
| `{objectid}` | 24 hexadecimal characters | Portal record identifier |

| Collection | List endpoint | Detail pattern |
|---|---|---|
| Tenders | `GET /pages/tenders` | `/pages/tenders/{slug}-{shortid}-{objectid}` |
| Jobs | `GET /pages/jobs` | `/pages/jobs/{slug}-{shortid}-{objectid}` |
| Government Orders | `GET /pages/go-ultimates` | `/pages/go-ultimates/{slug}-{shortid}-{objectid}` |
| Reports | `GET /pages/reports` | `/pages/reports/{slug}-{shortid}-{objectid}` |
| Publications | `GET /pages/publications` | `/pages/publications/{slug}-{shortid}-{objectid}` |
| Laws | `GET /pages/laws` | `/pages/laws/{slug}-{shortid}-{objectid}` |
| Policies | `GET /pages/policies` | `/pages/policies/{slug}-{shortid}-{objectid}` |
| Annual reports | `GET /pages/annual-reports` | `/pages/annual-reports/{slug}-{shortid}-{objectid}` |
| External links | `GET /pages/external-links` | `/pages/external-links/{slug}-{shortid}-{objectid}` |
| Officers | `GET /pages/officers` | `/pages/officers/{slug}-{shortid}-{objectid}` |

## E.3 Collection Query Contract

```http
GET /pages/{collection}?page={positive_integer}&rows={positive_integer}&filters={url_encoded_json}
```

| Parameter | Type | Observed use |
|---|---|---|
| `page` | positive integer | Requested page number |
| `rows` | positive integer | Rows per page; UI exposes 10, 20, 50, 100, and sometimes 250 |
| `filters` | URL-encoded JSON object | Usually `{"field_name":"objectid"}` |
| `groupBy` | field name | Collection grouping control |
| `orderBy` | field name or `-1` | Officer-list ordering; `-1` is default |
| `search` | string | Officer-list text search |
| `archived` | boolean | Notice archive selector: `true` |

### Confirmed Filter Values

**Officer categories** (`officer_category`): Chairmans Office `6922d2bd81fc96cef9e9a38a`, Textbook Member Wing `...a38e`, Finance Member Wing `...a38f`, Curriculum Member Wing `...a390`, Primary Curriculum Member Wing `...a391`, Secretary Office `...a38b`, Administration/Establishment `...a38c`, Common Service `...a38d`, ICT Cell `...a392`, and branch IDs through `...a3a2`. Fetch the complete mapping from the `officer_category` select on `/site/officer_list/{uuid}`.

**Report types** (`reports_type`): service/legal `6922d2c981fc96cef9e9a7ce`, annual performance `6922d29b81fc96cef9e995a9`, integrity `6922d29b81fc96cef9e995aa`, innovation `6922d2c781fc96cef9e9a70a`, budget implementation `6922d2a781fc96cef9e99b31`, and annual performance agreement `6922d2c281fc96cef9e9a55d`.

**Sitemap GO filters** (`order`): training/workshop `6922d29c81fc96cef9e995e1`, committee formation `6922d29e81fc96cef9e9970d`, laws/rules/policies `6922d29e81fc96cef9e9972f`.

Example:

```http
GET /pages/reports?filters=%7B%22reports_type%22%3A%20%226922d2a781fc96cef9e99b31%22%7D
```

Responses remain HTML. Parse returned links and pagination controls; never infer totals, category IDs, or slugs.
## E.4 Static and Nested Pages

Static pages accept either a 24-hex MongoDB-style ObjectId or a slug form ending in `-{shortid}-{objectid}`. Nested pages are reached through links in the parent `ContentViewerWidget`; child IDs are not derivable from the parent ID.

Representative hierarchy:

```http
GET /pages/static-pages/695b97ffc4774958d7b70329
GET /pages/static-pages/695b9b7cc4774958d7b70a12
GET /pages/static-pages/695b98afc4774958d7b7044c
GET /pages/static-pages/primary-and-secondary-level-teachers-guide-list-for-the-academic-year-2026-c7wlhh-69afb72b7ce407d4d4fdd16e
GET /pages/static-pages/ebtedayi-level-assessment-guidelines-2026-ezczi2-69f6fbff671bb4a704bb0f16
GET /pages/static-pages/teacher-training-manuals-for-5-indigenous-languages-mxqyf7-6a44d5067f5592e6266752ca
```

The 2026 textbook page exposes level routes; a level route then exposes class/year routes. Legacy pages can contain Google Drive links instead of NCTB object-storage links. Both are external to the API boundary and should be followed only when allowed by client policy.

## E.5 File Viewer and Downloads

```http
GET /pages/files/{objectid}
```

The response is an HTML viewer containing title, last-updated timestamp, and direct file links. Verified example:

```http
GET /pages/files/6922da22933eb65569e02aab
```

Its HTML contains a direct PDF URL with this shape:

```http
https://objectstorage.ap-dcc-gazipur-1.oraclecloud15.com/n/{namespace}/b/{bucket}/o/office-nctb/{year}/{month}/{object-hash}.pdf
```

Verified direct-file contract: `200 OK`, `application/pdf`, approximately 8.18 MB for the sample. Extract the complete URL from the parent viewer; do not construct it or infer an attachment ID from a parent content ID.

## E.6 Officer Directory Contract

```http
GET /site/officer_list/{uuid}
```

Verified UUID: `ad811fcf-dda0-487b-be24-6fd79e0d4eda`. The directory returns officers grouped by category and controls for `officer_category`, `orderBy`, `pageSize`, `search`, and page navigation. The verified rendering returned 250 rows by default. Records expose name, designation, office, email, office phone, intercom, room, mobile, fax, vCard download, and detail links.

Representative detail route:

```http
GET /pages/officers/{bangla_slug}-0469f3-6922dab6933eb65569e0626e
```

## E.7 Widget Parsing Guide

| Widget selector | Contains |
|---|---|
| `[data-widget_name="ContentViewerWidget"]` | Detail title, update time, body, child links, and attachments |
| `[data-widget_name="ContentBrowseWidget"]` | Officer directory, category groups, controls, and detail links |
| `[data-widget_name="DatatableBrowseWidget"]` | Collection rows, attachments, detail links, filters, grouping, and page-size controls |
| `[data-widget_name="InfoOfficersViewWidget"]` | Information-officer directory |
| `[data-widget_name="SiteMapViewWidget"]` | Current published navigation tree |

Isolate the widget before extracting links. The surrounding page shell repeats global navigation links and will otherwise create duplicates.

## E.8 Status and Error Behavior

| Route | Status | Behavior |
|---|---|---|
| Published subpages and filtered lists | `200` | HTML response; no authentication or API token |
| `/site/page/b543ab16-f60a-4e9f-a621-93b69b6c61cf` | `404` | Sitemap link exists, but target is unpublished/deprecated |
| `/pages/service-boxes` | `404` | Widget/legacy route, not a public endpoint |

Missing child IDs return the standard HTML 404 response (`text/html; charset=utf-8`). These routes do not provide a JSON error envelope.
## E.9 Current Sitemap Subpage Catalog

### Institutional Pages

| Endpoint | Sitemap label |
|---|---|
| `GET /site/officer_list/ad811fcf-dda0-487b-be24-6fd79e0d4eda` | About NCTB |
| `GET /pages/static-pages/6922e09d933eb65569e27d8c` | History |
| `GET /pages/laws` | Laws and rules |
| `GET /pages/files/6922da22933eb65569e02aab` | Regulations |
| `GET /pages/static-pages/6922dc46933eb65569e0f6b6` | Movable and immovable property list |
| `GET /pages/static-pages/6922dfd2933eb65569e2429b` | Functions |
| `GET /pages/static-pages/6922df54933eb65569e213f7` | Goals and objectives |
| `GET /pages/static-pages/6922dffd933eb65569e24f40` | Vision and mission |
| `GET /pages/static-pages/6922dd6c933eb65569e14fcc` | Citizen charter |
| `GET /pages/organograms/6922d921933eb65569dfcead` | Organogram |
| `GET /pages/officers` | Officers |
| `GET /views/info-officers` | Information officers |

### Curriculum, Assessment, and Policy Pages

| Endpoint | Sitemap label |
|---|---|
| `GET /pages/static-pages/6922dd0b933eb65569e13492` | Pre-primary and primary level, revised 2025 |
| `GET /pages/files/6922da05933eb65569e01e28` | Pre-primary curriculum 2011 |
| `GET /pages/files/6922d9f6933eb65569e015ea` | Primary curriculum 2011 |
| `GET /pages/files/6922db5b933eb65569e09a2c` | Secondary curriculum |
| `GET /pages/files/6922dbc6933eb65569e0c702` | Higher-secondary curriculum |
| `GET /pages/files/6922dbd3933eb65569e0cd02` | Primary education curriculum assessment |
| `GET /pages/static-pages/6922e00e933eb65569e253c7` | Supplementary reading policy |
| `GET /pages/static-pages/6922e06b933eb65569e26f64` | 2024 annual assessment guidance |
| `GET /pages/static-pages/6922dff5933eb65569e24d31` | Revised syllabi and question patterns |
| `GET /pages/static-pages/6922dda1933eb65569e15b1d` | JSC marks distribution and sample questions |
| `GET /pages/publications` | Policies, notices, and publications |
| `GET /pages/static-pages/6922dee4933eb65569e1e2b6` | Learning-gap identification and lesson plan |
| `GET /site/page/b543ab16-f60a-4e9f-a621-93b69b6c61cf` | Primary assessment guideline (currently 404) |
| `GET /pages/static-pages/6988638a3121d2f262f0eab3` | Primary assessment guideline 2026 |

### Textbook Root Pages

| Endpoint | Sitemap label |
|---|---|
| `GET /pages/static-pages/695b97ffc4774958d7b70329` | 2026 all-level textbooks |
| `GET /pages/static-pages/6922df2c933eb65569e20586` | 2025 all-level textbooks |
| `GET /pages/static-pages/6922de68933eb65569e1a70c` | 2024 all-level textbooks |
| `GET /pages/static-pages/6922de8f933eb65569e1b977` | English for Today listening text |
| `GET /pages/static-pages/6922dd35933eb65569e13f12` | 2023 all-level textbooks |
| `GET /pages/static-pages/6922dce3933eb65569e12943` | 2022 all-level textbooks |
| `GET /pages/static-pages/6922dbc9933eb65569e0c85a` | 2021 all-level textbooks |
| `GET /pages/static-pages/6922dd7f933eb65569e15431` | 2020 all-level textbooks |
| `GET /pages/static-pages/6922db65933eb65569e09ead` | 2019 all-level textbooks |
| `GET /pages/static-pages/6922dfc9933eb65569e23fcb` | 2018 textbook list |
| `GET /pages/static-pages/6922dc50933eb65569e0fa9f` | 2017 textbook list |
### Teacher Guides, Training, and Multimedia

| Endpoint | Sitemap label |
|---|---|
| `GET /pages/static-pages/primary-and-secondary-level-teachers-guide-list-for-the-academic-year-2026-c7wlhh-69afb72b7ce407d4d4fdd16e` | 2026 teacher guides |
| `GET /pages/static-pages/6922e0d7933eb65569e28cf0` | 2024 teacher guides |
| `GET /pages/static-pages/teacher-training-manuals-for-5-indigenous-languages-mxqyf7-6a44d5067f5592e6266752ca` | Teacher training manuals |
| `GET /pages/static-pages/6922de6d933eb65569e1a907` | 2023 teacher diary |
| `GET /pages/static-pages/ebtedayi-level-assessment-guidelines-2026-ezczi2-69f6fbff671bb4a704bb0f16` | Ebtedayi assessment guideline 2026 |
| `GET /pages/static-pages/6922dcf3933eb65569e12e58` | Primary assessment guideline |
| `GET /pages/static-pages/6922de33933eb65569e18f7c` | ICT class six |
| `GET /pages/static-pages/6922ddf7933eb65569e175ae` | Digital signature |
| `GET /pages/static-pages/6922df78933eb65569e22328` | Multimedia talking book |

### Governance, Disclosure, and Forms

| Endpoint | Sitemap label |
|---|---|
| `GET /pages/static-pages/6922db84933eb65569e0a912` | APA instructions/circulars/team |
| `GET /pages/static-pages/6922df64933eb65569e21ab2` | Action plan and reports |
| `GET /pages/static-pages/6922e03f933eb65569e26306` | Action plan and quarterly report |
| `GET /pages/annual-reports` | Various reports |
| `GET /pages/reports` | Annual performance agreements |
| `GET /pages/reports?filters=%7B%22reports_type%22%3A%20%226922d2a781fc96cef9e99b31%22%7D` | Budget and budget implementation |
| `GET /pages/web-forms/6922d3c481fc96cef9e9c017` | Citizen feedback/suggestion form |
| `GET /pages/static-pages/6922df5e933eb65569e21861` | Application and appeal forms |
| `GET /pages/static-pages/6922e07b933eb65569e2744c` | Responsible officers and appeal authority |
| `GET /pages/static-pages/6922e133933eb65569e2ad74` | Complaint and appeal officers |
| `GET /pages/static-pages/6922e136933eb65569e2ae72` | Citizen charter committee |
| `GET /pages/static-pages/6922dfe0933eb65569e2473b` | Information categories/catalog/laws |
| `GET /pages/static-pages/6922dfd9933eb65569e2429b` | Annual procurement plan |
| `GET /pages/notices?archived=true` | Archived notices |

### Innovation, GOs, Tenders, and News

| Endpoint | Sitemap label |
|---|---|
| `GET /pages/static-pages/6922de91933eb65569e1ba7a` | Innovation |
| `GET /pages/static-pages/6922e109933eb65569e29c11` | Innovation projects |
| `GET /pages/static-pages/6922dffa933eb65569e24e81` | Innovation committee |
| `GET /pages/go-ultimates` | NOC, foreign travel, and related orders |
| `GET /pages/go-ultimates?filters=%7B%22order%22%3A%20%226922d29c81fc96cef9e995e1%22%7D` | Training/workshop orders |
| `GET /pages/go-ultimates?filters=%7B%22order%22%3A%20%226922d29e81fc96cef9e9970d%22%7D` | Committee formation orders |
| `GET /pages/go-ultimates?filters=%7B%22order%22%3A%20%226922d29e81fc96cef9e9972f%22%7D` | Laws/rules/policies/orders |
| `GET /pages/tenders` | Tenders |
| `GET /pages/news` | Press releases/news |
| `GET /pages/jobs` | Job circulars |
| `GET /pages/policies` | Loan policy 2020 and policies |

### Class-Level Teacher Guide Catalog

| Endpoint | Sitemap label |
|---|---|
| `GET /pages/static-pages/6922de8f933eb65569e1b98b` | Class one guide |
| `GET /pages/static-pages/6922dcb2933eb65569e1196c` | Class six guide |
| `GET /pages/static-pages/6922dcd3933eb65569e12431` | Class seven guide |
| `GET /pages/static-pages/6922e144933eb65569e2b330` | Grade one guide |
| `GET /pages/static-pages/6922e097933eb65569e27ba4` | Grade two guide |
| `GET /pages/static-pages/6922de1d933eb65569e185c0` | Grade three guide |
| `GET /pages/static-pages/6922e0cf933eb65569e28a8d` | Grade four guide |
| `GET /pages/static-pages/6922e04d933eb65569e26653` | Grade five guide |

### Other Public Static Pages

| Endpoint | Sitemap label |
|---|---|
| `GET /pages/static-pages/6922dba5933eb65569e0b892` | Primary education curriculum assessment |
| `GET /pages/static-pages/6922df78933eb65569e22328` | 2023 Braille multimedia talking books |
| `GET /pages/static-pages/6922e072933eb65569e2718c` | History and functions |

> Routes above were extracted from `/views/sitemap`. Deeply nested textbook/class routes are intentionally not enumerated; crawl the relevant parent `ContentViewerWidget` at runtime to remain resilient to updates.
### Additional Disclosure and Complaint Routes

| Endpoint | Sitemap label |
|---|---|
| `GET /pages/files/6922da95933eb65569e05824` | Organizational structure file |
| `GET /pages/static-pages/6922ddfc933eb65569e1775c` | Proactively publishable information, annual report, and quarterly report |
| `GET /pages/static-pages/6922de0c933eb65569e17d88` | Integrity committee and award |
| `GET /pages/static-pages/6922de84933eb65569e1b39f` | Important documents |
| `GET /pages/static-pages/6922def2933eb65569e1ea1c` | Innovation award |
| `GET /pages/static-pages/6922df0b933eb65569e1f705` | Quarterly/annual audit, evaluation, and meeting reports |
| `GET /pages/static-pages/6922df35933eb65569e20953` | Complaint submission, grievance committee, and report application |
| `GET /pages/static-pages/6922dfd9933eb65569e244f5` | Annual procurement plan |
## E.10 Recursive Nested-Page Inventory

**Crawl performed:** 2026-08-14, starting from all 69 static-page and file-viewer routes in `/views/sitemap`.

### Discovery Contract

1. Request a sitemap root route.
2. Parse only its `[data-widget_name="ContentViewerWidget"]` container.
3. Extract every returned `/pages/static-pages/{objectid}` link.
4. Request each newly discovered child and repeat until no new child route is returned.
5. Record the full response-supplied URL; do not synthesize or mutate it.

### Observed Hierarchy

| Depth | Meaning | Routes |
|---|---|---|
| 0 | Sitemap static-page/file root | 69 |
| 1 | Child static page | 171 |
| 2 | Grandchild static page | 115 |
| **Total** | **Unique downloaded HTML pages** | **355** |

Additional measurements:

- 318 child edges were observed.
- 24 roots expose child pages; 331 pages are leaves.
- The hierarchy terminates at depth 2; every depth-2 page was parsed and exposed no further `/pages/static-pages/` links.
- All 355 routes were reachable from the sitemap roots.
- 22 child routes are referenced from more than one parent; maximum inbound reference count is 3.
- One referenced child returned `404`: `/pages/static-pages/6922e113933eb65569e2a0e9`, linked as “একাদশ- দ্বাদশ শ্রেণি” from the 2021 and 2020 textbook root pages. It is excluded from the reachable 355-page count and should be treated as a broken publication link.
- One wave-2 link returned `404` during crawling. Its exact path was not emitted into the reachable graph; clients should rely on response status rather than assuming every nested link is live.

### Complete Machine-Readable Catalog

The full route inventory is stored in `nested_routes_catalog.json` (355 objects) and rendered in full, human-readable form directly below in **[Appendix F](#appendix-f-complete-nested-static-page--file-catalog-355-routes)** — every endpoint this crawl reached is listed there, not just a JSON pointer. Each JSON object contains:

| Field | Type | Meaning |
|---|---|---|
| `path` | string | Absolute site path without base URL |
| `depth` | integer | `0` sitemap root, `1` child, `2` grandchild |
| `title` | string | Best title extracted from the content viewer widget |
| `parents` | array of strings | Paths whose `ContentViewerWidget` links to this route |
| `children` | integer | Number of outgoing nested static-page links |

Production integrations should still discover dynamically from each parent page so newly published or reorganized pages are not missed — this catalog is a point-in-time snapshot (2026-08-14), not a live index.

---



## Appendix F: Complete Nested Static-Page / File Catalog (355 routes)

Full recursive crawl result starting from the 69 sitemap-root static-page and file routes. Each root is followed to its children and grandchildren via the `ContentViewerWidget` links on the page; the hierarchy terminates at depth 2 (no depth-2 page exposed further nested links). Machine-readable source: `nested_routes_catalog.json`.

**Totals:** 69 depth-0 roots, 171 depth-1 children, 115 depth-2 grandchildren — **355 unique pages total**.

> One known broken link is excluded from this catalog: `/pages/static-pages/6922e113933eb65569e2a0e9` ("একাদশ- দ্বাদশ শ্রেণি"), linked from the 2021 and 2020 textbook root pages, returns `404`.

### `/pages/files/6922d9d5933eb65569e00751`
**মন্ত্রণালয়/বিভাগ/দপ্তর/সংস্থার সেবা প্রদান প্রতিশ্রুতি (সিটিজেন্‌স চার্টার) প্রণয়ন সংক্রান্ত নির্দেশিকা, ২০১৭**

_No child pages._

### `/pages/files/6922d9f6933eb65569e015ea`
**প্রাথমিক স্তরের শিক্ষাক্রম**

_No child pages._

### `/pages/files/6922da05933eb65569e01e28`
**প্রাক-প্রাথমিক স্তরের শিক্ষাক্রম**

_No child pages._

### `/pages/files/6922da22933eb65569e02aab`
**প্রবিধানমালা**

_No child pages._

### `/pages/files/6922da95933eb65569e05824`
**সাংগঠনিক কাঠামো**

_No child pages._

### `/pages/files/6922db5b933eb65569e09a2c`
**মাধ্যমিক স্তরের শিক্ষাক্রম(প্রকাশকাল -২০১২)**

_No child pages._

### `/pages/files/6922dbc6933eb65569e0c702`
**উচ্চ মাধ্যমিক স্তরের শিক্ষাক্রম**

_No child pages._

### `/pages/files/6922dbd3933eb65569e0cd02`
**Effectiveness and Need Assessment Analysis report of Primary Curriculum at the NCTB**

_No child pages._

### `/pages/static-pages/6922db65933eb65569e09ead`
**২০১৯ শিক্ষাবর্ষের সকল স্তরের পাঠ্যপুস্তকের তালিকা**

_No child pages._

### `/pages/static-pages/6922db84933eb65569e0a912`
**এপিএ নির্দেশিকা/পরিপত্র/এপিএ টিম**

_No child pages._

### `/pages/static-pages/6922dba5933eb65569e0b892`
**প্রাক-প্রাথমিক শিক্ষাক্রম ২০২২ (পরিমার্জিত ২০২৫)**

_No child pages._

### `/pages/static-pages/6922dbc9933eb65569e0c85a`
**২০২১ শিক্ষাবর্ষের সকল স্তরের পাঠ্যপুস্তকের তালিকা**

_No child pages._

### `/pages/static-pages/6922dc46933eb65569e0f6b6`
**স্থাবর অস্থাবর সম্পত্তির তালিকা**

_No child pages._

### `/pages/static-pages/6922dc50933eb65569e0fa9f`
**২০১৭ শিক্ষাবর্ষের বিভিন্ন স্তরের পাঠ্যপুস্তকের তালিকা**

_No child pages._

### `/pages/static-pages/6922dcb2933eb65569e1196c`
**শিক্ষক সহায়িকা- ৬ষ্ঠ শ্রেণি**

_No child pages._

### `/pages/static-pages/6922dcd3933eb65569e12431`
**শিক্ষক সহায়িকা- ৭ম শ্রেণি**

_No child pages._

### `/pages/static-pages/6922dce3933eb65569e12943`
**২০২২ শিক্ষাবর্ষের সকল স্তরের পাঠ্যপুস্তকের তালিকা**

_No child pages._

### `/pages/static-pages/6922dcf3933eb65569e12e58`
**প্রাথমিক স্তরের মূল্যায়ন নির্দেশিকা**

_No child pages._

### `/pages/static-pages/6922dd0b933eb65569e13492`
**প্রাক-প্রাথমিক ও প্রাথমিক স্তর (পরিমার্জিত ২০২৫)**

_No child pages._

### `/pages/static-pages/6922dd35933eb65569e13f12`
**২০২৩ শিক্ষাবর্ষের সকল স্তরের পাঠ্যপুস্তক**

_No child pages._

### `/pages/static-pages/6922dd6c933eb65569e14fcc`
**সিটিজেন চার্টার**

_No child pages._

### `/pages/static-pages/6922dd7f933eb65569e15431`
**২০২০ শিক্ষাবর্ষের সকল স্তরের পাঠ্যপুস্তকের তালিকা**

_No child pages._

### `/pages/static-pages/6922dda1933eb65569e15b1d`
**জেএসসি পরীক্ষার মান বন্টন ও নমুনা প্রশ্ন**

_No child pages._

### `/pages/static-pages/6922ddf7933eb65569e175ae`
**ডিজিটাল স্বাক্ষর সম্পর্কিত সাধারণ জিজ্ঞাসা**

_No child pages._

### `/pages/static-pages/6922ddfc933eb65569e1775c`
**স্বপ্রণোদিতভাবে প্রকাশযোগ্য তথ্য/বার্ষিক প্রতিবেদন**

_No child pages._

### `/pages/static-pages/6922de0c933eb65569e17d88`
**শুদ্ধাচার পুরস্কার ও কমিটি**

_No child pages._

### `/pages/static-pages/6922de1d933eb65569e185c0`
**শিক্ষক সহায়িকা- ৩য় শ্রেণি**

_No child pages._

### `/pages/static-pages/6922de33933eb65569e18f7c`
**TQI-II প্রকল্পের অর্থায়নে BRAC এর কারিগরি সহায়তায় NCTB কর্তৃক প্রণীত ৬ষ্ঠ শ্রেণির ১৬টি পাঠ্যপুস্তকের ইন্টারেক্টিভ ডিজিটাল টেক্সটবুক**

_No child pages._

### `/pages/static-pages/6922de68933eb65569e1a70c`
**২০২৪ শিক্ষাবর্ষের সকল স্তরের পাঠ্যপুস্তকের তালিকা**

_No child pages._

### `/pages/static-pages/6922de6d933eb65569e1a907`
**২০২৩ শিক্ষাবর্ষের ১ম শ্রেণির শিক্ষক ডায়রি**

_No child pages._

### `/pages/static-pages/6922de84933eb65569e1b39f`
**গুরুত্বপূর্ণ ডকুমেন্টসমূহ**

_No child pages._

### `/pages/static-pages/6922de8f933eb65569e1b977`
**English for Today Listening Text**

_No child pages._

### `/pages/static-pages/6922de8f933eb65569e1b98b`
**২০২৩ শিক্ষাবর্ষের শিক্ষক সহায়িকা- ১ম শ্রেণি**

_No child pages._

### `/pages/static-pages/6922de91933eb65569e1ba7a`
**বার্ষিক পাঠ পরিকল্পনা-২০১৭**

_No child pages._

### `/pages/static-pages/6922dee4933eb65569e1e2b6`
**শিখন ঘাটতি চিহ্নিতকরণ ও নিরাময়যোগ্য পাঠ পরিকল্পনা**

_No child pages._

### `/pages/static-pages/6922def2933eb65569e1ea1c`
**উদ্ভাবনী পুরস্কার**

_No child pages._

### `/pages/static-pages/6922df0b933eb65569e1f705`
**সেবা প্রদান প্রতিশ্রুতি ত্রৈমাসিক/বার্ষিক পরিবীক্ষণ/মূল্যায়ন প্রতিবেদন ও বিভিন্ন সভা**

_No child pages._

### `/pages/static-pages/6922df2c933eb65569e20586`
**২০২৫ শিক্ষাবর্ষের পাঠ্যপুস্তকের তালিকা**

_No child pages._

### `/pages/static-pages/6922df35933eb65569e20953`
**অভিযোগ প্রতিকার ব্যবস্থাপনা কমিটি ও প্রতিবেদন**

_No child pages._

### `/pages/static-pages/6922df54933eb65569e213f7`
**এনসিটিবি'র প্রতিষ্ঠানের লক্ষ্য ও উদ্দেশ্য**

_No child pages._

### `/pages/static-pages/6922df5e933eb65569e21861`
**তথ্য অধিকার ফরমসমূহ (আবেদন ও আপিল ফরম)**

_No child pages._

### `/pages/static-pages/6922df64933eb65569e21ab2`
**বার্ষিক উদ্ভাবন কর্মপরিকল্পনা ও প্রতিবেদন**

_No child pages._

### `/pages/static-pages/6922df78933eb65569e22328`
**২০২৩ শিক্ষাবর্ষের ব্রেইল পাঠ্যপুস্তকের সকল শ্রেণির মাল্টিমিডিয়া টকিং বুক এর তালিকা**

_No child pages._

### `/pages/static-pages/6922dfc9933eb65569e23fcb`
**২০১৮ শিক্ষাবর্ষের সকল স্তরের পাঠ্যপুস্তকের তালিকা**

_No child pages._

### `/pages/static-pages/6922dfd2933eb65569e2429b`
**কার্যাবলী**

_No child pages._

### `/pages/static-pages/6922dfd9933eb65569e244f5`
**বার্ষিক ক্রয় পরিকল্পনা**

_No child pages._

### `/pages/static-pages/6922dfe0933eb65569e2473b`
**তথ্যর ক্যাটাগরি ক্যাটালগ/আইন/বিধি**

_No child pages._

### `/pages/static-pages/6922dff5933eb65569e24d31`
**এসএসসি ও এইচএসসি পরীক্ষার পুনর্বিন্যাসকৃত পাঠ্যসূচি ও নবম দশম শ্রেণির বিভিন্ন বিষয়ের প্রশ্নের ধরন ও নম্বর বিভাজন এবং তদানুযায়ী তৈরি নমুনা প্রশ্ন**

_No child pages._

### `/pages/static-pages/6922dffa933eb65569e24e81`
**ইনোভেশন টিম**

_No child pages._

### `/pages/static-pages/6922dffd933eb65569e24f40`
**রূপকল্প ও অভিলক্ষ্য**

_No child pages._

### `/pages/static-pages/6922e00e933eb65569e253c7`
**সম্পূরক পঠনসামগ্রী প্রণয়ন ও নির্বাচন নীতিমালা ২০২৫**

_No child pages._

### `/pages/static-pages/6922e03f933eb65569e26306`
**শুদ্ধাচার প্রতিবেদন**

_No child pages._

### `/pages/static-pages/6922e04d933eb65569e26653`
**শিক্ষক সহায়িকা- ৫ম শ্রেণি**

_No child pages._

### `/pages/static-pages/6922e06b933eb65569e26f64`
**২০২৪ শিক্ষাবর্ষের বার্ষিক সামষ্টিক মূল্যায়ন নির্দেশনা**

_No child pages._

### `/pages/static-pages/6922e072933eb65569e2718c`
**ইতিহাস ও কার্যাবলী**

_No child pages._

### `/pages/static-pages/6922e07b933eb65569e2744c`
**তথ্য অধিকার কমিটি**

_No child pages._

### `/pages/static-pages/6922e097933eb65569e27ba4`
**শিক্ষক সহায়িকা- ২য় শ্রেণি**

_No child pages._

### `/pages/static-pages/6922e09d933eb65569e27d8c`
**জাতীয় শিক্ষাক্রম ও পাঠ্যপুস্তক বোর্ডের ইতিবৃত্ত**

_No child pages._

### `/pages/static-pages/6922e0cf933eb65569e28a8d`
**শিক্ষক সহায়িকা- ৪র্থ শ্রেণি**

_No child pages._

### `/pages/static-pages/6922e0d7933eb65569e28cf0`
**২০২৪ শিক্ষাবর্ষের প্রাথমিক ও মাধ্যমিক স্তরের শিক্ষক সহায়িকার তালিকা**

_No child pages._

### `/pages/static-pages/6922e109933eb65569e29c11`
**এনসিটিবির উদ্ভাবনী উদ্যোগের তালিকা**

_No child pages._

### `/pages/static-pages/6922e133933eb65569e2ad74`
**অভিযোগ নিষ্পত্তি কর্মকর্তা ও আপিল কর্মকর্তা**

_No child pages._

### `/pages/static-pages/6922e136933eb65569e2ae72`
**সিটিজেন চার্টার কমিটি**

_No child pages._

### `/pages/static-pages/6922e144933eb65569e2b330`
**শিক্ষক সহায়িকা- ১ম শ্রেণি**

_No child pages._

### `/pages/static-pages/695b97ffc4774958d7b70329`
**২০২৬ শিক্ষাবর্ষের পাঠ্যপুস্তকের তালিকা**

_No child pages._

### `/pages/static-pages/6988638a3121d2f262f0eab3`
**প্রাথমিক স্তরের মূল্যায়ন নির্দেশিকা - ২০২৬**

_No child pages._

### `/pages/static-pages/ebtedayi-level-assessment-guidelines-2026-ezczi2-69f6fbff671bb4a704bb0f16`
**ইবতেদায়ি স্তরের মূল্যায়ন নির্দেশিকা-২০২৬**

_No child pages._

### `/pages/static-pages/primary-and-secondary-level-teachers-guide-list-for-the-academic-year-2026-c7wlhh-69afb72b7ce407d4d4fdd16e`
**২০২৬ শিক্ষাবর্ষের প্রাক-প্রাথমিক, প্রাথমিক ও মাধ্যমিক স্তরের শিক্ষক সহায়িকার তালিকা**

_No child pages._

### `/pages/static-pages/teacher-training-manuals-for-5-indigenous-languages-mxqyf7-6a44d5067f5592e6266752ca`
**ক্ষুদ্র নৃগোষ্ঠীর ৫টি ভাষার “শিক্ষক প্রশিক্ষণ ম্যানুয়াল”**

_No child pages._
## Appendix G: Real Content Links (post-decode extraction)

**Crawl performed:** 2026-08-15, re-visiting all 355 pages from [Appendix F](#appendix-f-complete-nested-static-page--file-catalog-355-routes), this time decoding every `<rt-renderer encoded-content="...">` block per §16 and extracting every `<a href>` found inside — not just `/pages/static-pages/` links.

**Result:** 260 of 355 pages (73%) carry real external content links; the other 95 are genuinely empty/unpublished bodies (confirmed by decoding, not assumed from a plain-HTML check). **3,092 total links extracted.**

### G.1 Link-type breakdown

| Host | Count | What it is |
|---|---:|---|
| `drive.google.com` | 2,599 | Book/document PDFs hosted on Google Drive (the primary distribution channel) |
| `drive.egovcloud.gov.bd` | 410 | Mirror/secondary download links on the government's own eGov cloud |
| `objectstorage.ap-dcc-gazipur-1.oraclecloud15.com` | 49 | Direct PDF/DOCX links on NCTB's own Oracle Object Storage bucket (`V2Ministry`) |
| `docs.google.com` | 20 | Google Docs–hosted documents (teacher guides) |
| `nctb.gov.bd` (relative, internal) | 7 | In-body links to other NCTB pages (e.g. a linked notice) |
| `mof.gov.bd` | 1 | Cross-referenced page on the Ministry of Finance's own NPF site |
| Editor placeholders (`#`) | 4 | Empty/unlinked "Download" buttons left blank by the content editor — not usable |

None of these were reachable in the original Appendix F catalog, which only recorded internal `/pages/static-pages/` navigation links.

### G.2 Class 1 (Grade 1) primary-level textbooks — every year on record

This is the exact data the original “can you download the Class 1 book via API” question needed. All 25 “প্রথম শ্রেণি” (Class 1 / Grade 1) pages found anywhere in the 355-page catalog, decoded, with subject-labeled download links (a prior version of this table dumped raw URLs with no subject label — fixed here) — **2026 (current academic year) is listed first**:

**২০২৬ শিক্ষাবর্ষের ইবতেদায়ি স্তরের প্রথম শ্রেণির পাঠ্যপুস্তক** — `/pages/static-pages/695b9b29c4774958d7b70995`

| Subject | Download link(s) |
|---|---|
| আমার বাংলা বই | [1](https://drive.google.com/file/d/1hY6Hjdw9Tr2R7fjQmbZMc_jeP0qJHEEA/view?usp=drive_link)<br>[2](https://drive.egovcloud.gov.bd/index.php/s/eAYC8Ud0aM2fOpu) |
| English for Today | [1](https://drive.google.com/file/d/18jBhx_tCsjE2x2MFOmoJU-xwXGm88bCq/view?usp=drive_link)<br>[2](https://drive.egovcloud.gov.bd/index.php/s/YBEAPtzsvy7W4Bz) |
| গণিত | [1](https://drive.google.com/file/d/1QgTfOFPGli-OlXPVrOMioKGNmcyFN-VW/view?usp=drive_link)<br>[2](https://drive.egovcloud.gov.bd/index.php/s/RCneqQTYuoPy7kv) |
| কুরআন মাজিদ ও তাজভিদ | [1](https://drive.google.com/file/d/1cPWmd0GOITHffO2oQd0gPHGRVZcyttot/view?usp=drive_link)<br>[2](https://drive.egovcloud.gov.bd/index.php/s/CXnvN9hLSkE0Fxm) |
| আকাইদ ও ফিকহ | [1](https://drive.google.com/file/d/1hhab35eA0XHy8VqW6PYnJvgETgvZlAAE/view?usp=drive_link)<br>[2](https://drive.egovcloud.gov.bd/index.php/s/5BPc1WFArFfMkr9) |
| আদদুরুসুল আরাবিয়্যাহ | [1](https://drive.google.com/file/d/112Zt1Me1BUmvToLaRL-E3JFYiYQnkocJ/view?usp=drive_link)<br>[2](https://drive.egovcloud.gov.bd/index.php/s/WLm9qFt7EFqZ1l5) |

**২০২৬ শিক্ষাবর্ষের প্রাথমিক স্তরের প্রথম শ্রেণির পাঠ্যপুস্তক** — `/pages/static-pages/695b9adec4774958d7b708cd`

| Subject | Download link(s) |
|---|---|
| আমার বাংলা বই | [1](https://drive.google.com/file/d/1hf-W5GVlAy3cHstFlozNBuE2oz7u9YXy/view?usp=drive_link)<br>[2](https://drive.egovcloud.gov.bd/index.php/s/j2OipTMp0QihpIR) |
| English for Today | [1](https://drive.google.com/file/d/1UX9fbOBUKrf3mMh6E0I-Gw2emoQV-XWy/view?usp=drive_link)<br>[2](https://drive.egovcloud.gov.bd/index.php/s/CW6nYiJRMJE8trb) |
| প্রাথমিক গণিত | [1](https://drive.google.com/file/d/1V5eBwsQYrG-6qajVZUwwetml5Oezl10r/view?usp=drive_link)<br>[2](https://drive.egovcloud.gov.bd/index.php/s/UhraLRRxdBynh1U)<br>[3](https://drive.google.com/file/d/1D8QeLW7SZ2d7oPJM3TmQei9_bOEet2i5/view?usp=drive_link)<br>[4](https://drive.egovcloud.gov.bd/index.php/s/lp11ImNTfh7T9Xh) |

**২০১৭ শিক্ষাবর্ষের প্রথম শ্রেণির পাঠ্যপুস্তক** — `/pages/static-pages/6922db9a933eb65569e0b372`

| Subject | Download link(s) |
|---|---|
| আমার বাংলা বই | [1](http://drive.google.com/file/d/1iBJuNDh8j-NbkSbNiNuCqCxjb_sz_nrb/view?usp=drive_link) |
| English for Today | [1](http://drive.google.com/file/d/1kTW8nTinaHwYrZCAi5e_d9Ol4o1bGahX/view?usp=drive_link) |

**২০১৭ শিক্ষাবর্ষের প্রথম শ্রেণির পাঠ্যপুস্তক (ইংরেজি ভার্সন)** — `/pages/static-pages/6922e0d2933eb65569e28b9a`

| Subject | Download link(s) |
|---|---|
| আমার বাংলা বই | [1](http://drive.google.com/file/d/1iBJuNDh8j-NbkSbNiNuCqCxjb_sz_nrb/view?usp=sharing) |
| প্রাথমিক গণিত | [1](http://drive.google.com/file/d/1J4YiEIKjN2qD-MkXRR3q99jx5xr03v2y/view?usp=sharing) |
| English For Today | [1](http://drive.google.com/file/d/1kTW8nTinaHwYrZCAi5e_d9Ol4o1bGahX/view?usp=drive_link) |

**২০১৮ শিক্ষাবর্ষের ইবতেদায়ি স্তরের প্রথম শ্রেণির পাঠ্যপুস্তক** — `/pages/static-pages/6922debf933eb65569e1d165`

| Subject | Download link(s) |
|---|---|
| আমার বাংলা বই | [1](https://drive.google.com/open?id=1JJgEhJHP15DdCbOEtkIM9Mdpw7M64-iC) |
| English for Today | [1](https://drive.google.com/open?id=1KYdmpOI_elk1HdMLxHYWgVHdupCrajpW) |
| গণিত | [1](https://drive.google.com/open?id=1LktO3N2JyU8Pv74yuOH5BOAhhGD4r66f) |
| কুরআন মাজিদ ও তাজভিদ | [1](https://drive.google.com/open?id=1PX16CuaalpQGSynlPA6uXX_J43KQHCGx) |
| আকাইদ ও ফিক্হ | [1](https://drive.google.com/open?id=15zzeYEkURJdvqa-NvAe56PyxbXyXSvOV) |
| আদ্ দুরূসুল আরাবিয়্যাহ্ | [1](https://drive.google.com/open?id=1j-TS4dv94xPev0GGk5zBuiFe2askXxUZ) |

**২০১৮ শিক্ষাবর্ষের প্রথম শ্রেণির পাঠ্যপুস্তক** — `/pages/static-pages/6922dfa9933eb65569e2351e`

| Subject | Download link(s) |
|---|---|
| আমার বাংলা বই | [1](https://drive.google.com/open?id=1eMzvoNsFTY6hfnOeokPGFd-HNhxlNky2) |
| English for Today | [1](https://drive.google.com/open?id=1aTFb-lLslj_1R09kF7iXS0aEook5AI4z) |
| প্রাথমিক গণিত | [1](https://drive.google.com/open?id=1EiJYeXx7oNvWtDvNX4VtNEWbsFoNMkrl)<br>[2](https://drive.google.com/open?id=1iHfgRYBVvB9wjLvNbjBCseIsLrP_RSS_) |

**২০১৯ শিক্ষাবর্ষের ইবতেদায়ি স্তরের প্রথম শ্রেণির পাঠ্যপুস্তক** — `/pages/static-pages/6922df60933eb65569e2193b`

| Subject | Download link(s) |
|---|---|
| আমার বাংলা বই | [1](https://drive.google.com/open?id=17RLNGt5NAvkpKj0U3FmtSyx01oh4l-lW) |
| English for Today | [1](https://drive.google.com/open?id=1x5xCvSleFzdhUuLgY9-30l0pvLSThhrh) |
| গণিত | [1](https://drive.google.com/open?id=1dISXnEn24o4b0A9NMaSHKGkRnVKbRw0G) |
| কুরআন মাজিদ ও তাজভিদ | [1](https://drive.google.com/open?id=1aI7w6oiJM7OLXsgpSUtaPgdEmHi8teNd) |
| আকাইদ ও ফিক্হ | [1](https://drive.google.com/open?id=1RcdN_UtmxupRiU426FBvj9FHkm8YVVja) |
| আদ্ দুরূসুল আরাবিয়্যাহ্ | [1](https://drive.google.com/open?id=1lq0SK6UZ9qes24FUAnjqeeGW-5neD5G4) |

**২০১৯ শিক্ষাবর্ষের ক্ষুদ্র নৃগোষ্ঠির প্রথম শ্রেণির পাঠ্যপুস্তক** — `/pages/static-pages/6922dedd933eb65569e1df2e`

| Subject | Download link(s) |
|---|---|
| আমার বাংলা বই | [1](https://drive.google.com/open?id=19RFSuiOg23tticR-7ox5hjaVUMdO283N)<br>[2](https://drive.google.com/open?id=1QH2QuKt7O7UtejXMgQOFGeFfNFTbarwL)<br>[3](https://drive.google.com/open?id=1KgnxfwvyhenKOEr0tZ30ukxZeXcJnlFj)<br>[4](https://drive.google.com/open?id=1E3PP8t0Xs4y1VsFoDv3lyTxt4yqF6QJX)<br>[5](https://drive.google.com/open?id=1yST_1zvo0wTsTu-MhGFYTB_dqXS2YWcd) |
| English for Today | [1](https://drive.google.com/open?id=1ChUaHIUXlY8oGQfMc5riUOP7fd_v-K6G) |
| গণিত | [1](https://drive.google.com/open?id=1NUI30olsUBbbjSQaxUoBrc8ekU9et3mY)<br>[2](https://drive.google.com/open?id=1mZ6V89iKwK6ra03Db8m-miQd462eacLp)<br>[3](https://drive.google.com/open?id=1EYrebf6-kRvA69OWD5PmUNMqqDIJ2F8s)<br>[4](https://drive.google.com/open?id=1FLFXHMp7C7vvXW0yKSR9thqWlCIwmmN_)<br>[5](https://drive.google.com/open?id=1MlX7y96sZi80EHqJR9IJjZDedYhhZ56a) |

**২০১৯ শিক্ষাবর্ষের প্রাথমিক স্তরের প্রথম শ্রেণির পাঠ্যপুস্তক** — `/pages/static-pages/6922df96933eb65569e22edc`

| Subject | Download link(s) |
|---|---|
| আমার বাংলা বই | [1](https://drive.google.com/open?id=1IHingNjyeiM-zrFaSUbtO_vNPMsB8ba7) |
| English for Today | [1](https://drive.google.com/open?id=1ChUaHIUXlY8oGQfMc5riUOP7fd_v-K6G) |
| প্রাথমিক গণিত | [1](https://drive.google.com/open?id=1p4Xbw5c_ZnyxhSQ6l7YGEyuacrg_LtJp)<br>[2](https://drive.google.com/open?id=1HM9E271xgd-6l4M1Cymx0gFVxXedaW7g) |

**২০২০ শিক্ষাবর্ষের ইবতেদায়ি স্তরের প্রথম শ্রেণির পাঠ্যপুস্তক** — `/pages/static-pages/6922dfd3933eb65569e242f9`

| Subject | Download link(s) |
|---|---|
| আমার বাংলা বই | [1](https://drive.google.com/open?id=1kMq9oEiT8QxUdoXtrOZZI1l4sm9B8H6Y) |
| English for Today | [1](https://drive.google.com/open?id=1eTgq1b5JQLb2acidLEZosvG8_RTcavKD) |
| গণিত | [1](http://drive.google.com/open?id=1AHEnx-RNKRS7Z1BA6vBXzpB-mNtBsqwo) |
| কুরআন মাজিদ ও তাজভিদ | [1](https://drive.google.com/open?id=1-fAV0UtQSk-AYFYS6wAJliO8TpAp5KL7) |
| আকাইদ ও ফিক্হ | [1](https://drive.google.com/open?id=1_ZTOCKYXfcont3KRVmukNnxIt1RoDWqI) |
| আদ্ দুরূসুল আরাবিয়্যাহ্ | [1](https://drive.google.com/open?id=1ZyeJSwD1bxae7tqF0yKQeBWkLznB9Vs8) |

**২০২০ শিক্ষাবর্ষের ক্ষুদ্র নৃগোষ্ঠির প্রথম শ্রেণির পাঠ্যপুস্তক** — `/pages/static-pages/6922e12f933eb65569e2ac0d`

| Subject | Download link(s) |
|---|---|
| আমার বাংলা বই | [1](https://drive.google.com/open?id=1W5JnBboJSt38Q_63o-fTrKAT9NxOJqgW)<br>[2](https://drive.google.com/open?id=1EzbuEdHNS_SPa36iV90S8Y7iFCPHcWFE)<br>[3](https://drive.google.com/open?id=16gA8hCwd8TToeyZjxsdM55zCz4biziCC)<br>[4](https://drive.google.com/open?id=19hXRVW4XPiSj8LIPX-wTYUR1FhL_eYZO)<br>[5](https://drive.google.com/open?id=16du7FUQOYxP0JGiYO-4GnLELOOe0fx3o) |
| English for Today | [1](https://drive.google.com/open?id=1vdZA4d4jVJFSy6BgGl-wAyP75uqoiGMN) |
| গণিত | [1](https://drive.google.com/open?id=1A-2L38C7CLXfRbte1iBe9ZfMnHhByp7h)<br>[2](http://drive.google.com/open?id=1coUH26i4kN-t1dMSTTlM1B3V2jK43f6s)<br>[3](http://drive.google.com/open?id=1Zxcu6dpGWsmBW7hywNgNTpXViUatESzj)<br>[4](http://drive.google.com/open?id=1H2mzPoIV5whrDbKghx72hb_ZjI7QZdh7)<br>[5](http://drive.google.com/open?id=1o4DoV-CiIuUuhlq3mj96VDjjluArQfWV) |

**২০২০ শিক্ষাবর্ষের প্রাথমিক স্তরের প্রথম শ্রেণির পাঠ্যপুস্তক** — `/pages/static-pages/6922e091933eb65569e279c2`

| Subject | Download link(s) |
|---|---|
| আমার বাংলা বই | [1](https://drive.google.com/open?id=1TPHsoBYBY-e_9P6OB-227HNF8mziG7ZZ) |
| English for Today | [1](https://drive.google.com/open?id=1vdZA4d4jVJFSy6BgGl-wAyP75uqoiGMN) |
| প্রাথমিক গণিত | [1](http://drive.google.com/open?id=1UKcRnDcBi_6HX2rXuxTs6MJf0ki-xHpc)<br>[2](http://drive.google.com/open?id=1hKJI8z_CIt6RWy3S1yCO5u7sDpiKicya) |

**২০২১ শিক্ষাবর্ষের ইবতেদায়ি স্তরের প্রথম শ্রেণির পাঠ্যপুস্তক** — `/pages/static-pages/6922dd2f933eb65569e13d84`

| Subject | Download link(s) |
|---|---|
| আমার বাংলা বই | [1](https://drive.google.com/file/d/11sQzp294o0JF9VtCCcBUz6gyQyzpds-p/view?usp=sharing) |
| English for Today | [1](https://drive.google.com/file/d/1SLaLGlKn-4v4yn04JgGENGb9wh5OphZY/view?usp=sharing) |
| গণিত | [1](https://drive.google.com/file/d/1YI7-qt-MoLD968YNrZCBbo10FpcuhrDP/view?usp=sharing) |
| কুরআন মাজিদ ও তাজভিদ | [1](https://drive.google.com/file/d/1AlVJXVWLzeM_chPOY-lGq2cM4muPL9M5/view?usp=sharing) |
| আকাইদ ও ফিক্হ | [1](https://drive.google.com/file/d/1HqYgh4WgcDhszTtmXF7YN00TIHAAVuS1/view?usp=sharing) |
| আদ্ দুরূসুল আরাবিয়্যাহ্ | [1](https://drive.google.com/file/d/1QRQE_IFUkkOSNgRfpLfSskR5MeB1VtCw/view?usp=sharing) |

**২০২১ শিক্ষাবর্ষের প্রাথমিক স্তরের প্রথম শ্রেণির পাঠ্যপুস্তক** — `/pages/static-pages/6922dc87933eb65569e10d6a`

| Subject | Download link(s) |
|---|---|
| আমার বাংলা বই | [1](https://drive.google.com/file/d/1YAC42sxSW9_29z7EmfvBGQu9RKjA5o6_/view?usp=sharing) |
| English for Today | [1](https://drive.google.com/file/d/1H1t707L_Z1ssLzeuFAAcx-Hvm2FT42nQ/view?usp=sharing)<br>[2](http://drive.google.com/file/d/1H1t707L_Z1ssLzeuFAAcx-Hvm2FT42nQ/view?usp=sharing) |
| প্রাথমিক গণিত | [1](https://drive.google.com/file/d/1fC7dHWx5umIinAbYQRmfjMhg4w2yRaAx/view?usp=sharing)<br>[2](https://drive.google.com/file/d/1lCFQ6kldKZxcZwT4okA7WTxav9DNRg88/view?usp=sharing) |

**২০২২ শিক্ষাবর্ষের ইবতেদায়ি স্তরের প্রথম শ্রেণির পাঠ্যপুস্তক** — `/pages/static-pages/6922dcda933eb65569e12671`

| Subject | Download link(s) |
|---|---|
| আমার বাংলা বই | [1](http://drive.google.com/file/d/1u9PWYorQ0EnQyy0H4tviPwTeV59KAiGY/view?usp=sharing) |
| English for Today | [1](http://drive.google.com/file/d/1WlBLDnxjDedX2aAPVBxDtbIJujinGMoo/view?usp=sharing) |
| গণিত | [1](http://drive.google.com/file/d/1eZgvMBKchrbjLBgFColQQlT4O-tl10w8/view?usp=sharing) |
| কুরআন মাজিদ ও তাজভিদ | [1](http://drive.google.com/file/d/1wArmSxkqa4DKPhdGV9Zan8UHtICQCtfL/view?usp=sharing) |
| আকাইদ ও ফিক্হ | [1](https://drive.google.com/file/d/1J-jj6kcsB6j8HQegRkxRIr3os1JGHMW3/view?usp=sharing) |
| আদ্ দুরূসুল আরাবিয়্যাহ্ | [1](http://drive.google.com/file/d/1m4NsJgRlFikOoniKVnH-OVJxU_6Y4k-O/view?usp=sharing) |

**২০২২ শিক্ষাবর্ষের ক্ষুদ্র নৃগোষ্ঠির প্রথম শ্রেণির পাঠ্যপুস্তক** — `/pages/static-pages/6922dd98933eb65569e15931`

| Subject | Download link(s) |
|---|---|
| আমার বাংলা বই | [1](https://drive.google.com/file/d/1KkpKQlCVW9AkUR9DeoUeevGyljWf_gnw/view?usp=sharing)<br>[2](https://drive.google.com/file/d/13bAUsT5UPIu442GM9cOVt5S8G_H9lTCw/view?usp=sharing)<br>[3](https://drive.google.com/file/d/1zPnvKEW01KwY6OffyfRUx5nF7FfOSKSl/view?usp=sharing)<br>[4](https://drive.google.com/file/d/1z3J-HxcHy4iNjvGa6tAoANmswYxZYPxt/view?usp=sharing)<br>[5](https://drive.google.com/file/d/16DJr0YWAmOJiKHVeN93y5VfBmXdWWRkA/view?usp=sharing) |
| English for Today | [1](https://drive.google.com/file/d/10QoWhNxnKZOQXre4LHQcVs2qWqGNtwZ1/view?usp=sharing) |
| গণিত | [1](https://drive.google.com/file/d/1N_rWUXo9vxqOmkFvqUYwUq1H3p5DEaTt/view?usp=sharing)<br>[2](https://drive.google.com/file/d/124uBAXfZogXuzb2_4edEnLZ9C8NjjxYC/view?usp=sharing)<br>[3](https://drive.google.com/file/d/1dbwy5gyzp2xD4lcuax1OBrPqasXLQ6qA/view?usp=sharing)<br>[4](https://drive.google.com/file/d/1vpYH81SVDEm_dqoYPNiygxYueN3pjWTe/view?usp=sharing)<br>[5](https://drive.google.com/file/d/12C10qgYcWpW6WEba43tROzO4sdV-0b4d/view?usp=sharing) |

**২০২২ শিক্ষাবর্ষের প্রাথমিক স্তরের প্রথম শ্রেণির পাঠ্যপুস্তক** — `/pages/static-pages/6922dcc3933eb65569e11e85`

| Subject | Download link(s) |
|---|---|
| আমার বাংলা বই | [1](https://drive.google.com/file/d/1DmsuTQ9v5BCmiUoqKnpKL3ou-mp2pl-r/view?usp=sharing) |
| English for Today | [1](https://drive.google.com/file/d/10QoWhNxnKZOQXre4LHQcVs2qWqGNtwZ1/view?usp=sharing) |
| প্রাথমিক গণিত | [1](https://drive.google.com/file/d/1siUN1QwjG0ShXafp2vc4UD2PTSMk6_KE/view?usp=sharing)<br>[2](http://drive.google.com/file/d/1XVpkkZmLAq6ea4uK2J0PXWhyPb4VWk48/view?usp=sharing) |

**২০২৩ শিক্ষাবর্ষের ইবতেদায়ি স্তরের প্রথম শ্রেণির পাঠ্যপুস্তক** — `/pages/static-pages/6922df38933eb65569e20a76`

| Subject | Download link(s) |
|---|---|
| আমার বাংলা বই | [1](http://drive.google.com/file/d/1JCOxHRWmevb1l8fRzXVtmO-3vQc6mN1V/view?usp=share_link) |
| English for Today | [1](http://drive.google.com/file/d/1OGDrjCL09kvM5MxamtAuZUbS-stc3yCB/view?usp=share_link) |
| গণিত | [1](http://drive.google.com/file/d/1VA3svaeGSswNnaSMog7NqJ2csZLTUW1c/view?usp=share_link) |
| কুরআন মাজিদ ও তাজভিদ | [1](http://drive.google.com/file/d/1V80ApVMk3TuP33VEjDn4XOiNS8AyUWfy/view?usp=share_link) |
| আকাইদ ও ফিক্হ | [1](http://drive.google.com/file/d/1sOlUrMZ7MDBSKUKwjlLaPZv2MC1Y6bPd/view?usp=share_link) |
| আদ্ দুরূসুল আরাবিয়্যাহ্ | [1](http://drive.google.com/file/d/1gQQmjIY1_5x-9K5HbE5DmD2SgFqpuakW/view?usp=share_link) |

**২০২৩ শিক্ষাবর্ষের ক্ষুদ্র নৃগোষ্ঠির প্রথম শ্রেণির পাঠ্যপুস্তক** — `/pages/static-pages/6922db87933eb65569e0aa20`

| Subject | Download link(s) |
|---|---|
| আমার বাংলা বই | [1](https://drive.google.com/file/d/1KkpKQlCVW9AkUR9DeoUeevGyljWf_gnw/view?usp=sharing)<br>[2](https://drive.google.com/file/d/13bAUsT5UPIu442GM9cOVt5S8G_H9lTCw/view?usp=sharing)<br>[3](https://drive.google.com/file/d/1zPnvKEW01KwY6OffyfRUx5nF7FfOSKSl/view?usp=sharing)<br>[4](https://drive.google.com/file/d/1z3J-HxcHy4iNjvGa6tAoANmswYxZYPxt/view?usp=sharing)<br>[5](https://drive.google.com/file/d/16DJr0YWAmOJiKHVeN93y5VfBmXdWWRkA/view?usp=sharing) |
| English for Today | [1](https://drive.google.com/file/d/10QoWhNxnKZOQXre4LHQcVs2qWqGNtwZ1/view?usp=sharing) |
| গণিত | [1](https://drive.google.com/file/d/1N_rWUXo9vxqOmkFvqUYwUq1H3p5DEaTt/view?usp=sharing)<br>[2](https://drive.google.com/file/d/124uBAXfZogXuzb2_4edEnLZ9C8NjjxYC/view?usp=sharing)<br>[3](https://drive.google.com/file/d/1dbwy5gyzp2xD4lcuax1OBrPqasXLQ6qA/view?usp=sharing)<br>[4](https://drive.google.com/file/d/1vpYH81SVDEm_dqoYPNiygxYueN3pjWTe/view?usp=sharing)<br>[5](https://drive.google.com/file/d/12C10qgYcWpW6WEba43tROzO4sdV-0b4d/view?usp=sharing) |

**২০২৩ শিক্ষাবর্ষের প্রাথমিক স্তরের প্রথম শ্রেণির পাঠ্যপুস্তক** — `/pages/static-pages/6922e0a8933eb65569e280e6`

| Subject | Download link(s) |
|---|---|
| আমার বাংলা বই | [1](http://drive.google.com/file/d/1bZb5BKigq283H4X6RApyO24lsYqRmR15/view?usp=share_link) |
| English for Today | [1](http://drive.google.com/file/d/1PBiBiz6GrRRrWOLLhKhthsxPhAAsYfpc/view?usp=share_link) |
| প্রাথমিক গণিত | [1](http://drive.google.com/file/d/1FBsbGCrfGM4FM9yywuXWf8giaVHr7UR6/view?usp=share_link)<br>[2](http://drive.google.com/file/d/1V2mKduz2k5jd2qQn6C5Im6UqsdAFTQW5/view?usp=share_link) |

**২০২৩ শিক্ষাবর্ষের প্রাথমিক স্তরের প্রথম শ্রেণির মাল্টিমিডিয়া টকিং বুক** — `/pages/static-pages/6922db91933eb65569e0aed7`

| Subject | Download link(s) |
|---|---|
| আমার বাংলা বই | [1](http://drive.google.com/file/d/1Xcq73G_X5NHCTXeTOMGrh6yy5IHjA9JS/view?usp=share_link) |
| English for Today | [1](http://drive.google.com/file/d/1v4p9FQoExlWpPUxH5ei8pvOtf1OHAMSn/view?usp=share_link) |
| প্রাথমিক গণিত | [1](http://drive.google.com/file/d/1DtNcxTQTNs2-My61yRbCuw6YtY6cAlHV/view?usp=share_link) |

**২০২৪ শিক্ষাবর্ষের ইবতেদায়ি স্তরের প্রথম শ্রেণির পাঠ্যপুস্তক** — `/pages/static-pages/6922df8f933eb65569e22c36`

| Subject | Download link(s) |
|---|---|
| আমার বাংলা বই | [1](https://drive.google.com/file/d/1t85F_DKdJzEKRpHrrgCkpjQ4aS0OvlE8/view?usp=sharing) |
| English for Today | [1](https://drive.google.com/file/d/1jXG1O11PxdXjYtYBQmXevQnBQ78jOe01/view?usp=sharing) |
| গণিত | [1](https://drive.google.com/file/d/12UMr0avkDGql9TNpz_zcR2X5-df6CGRJ/view?usp=sharing) |
| কুরআন মাজিদ ও তাজভিদ | [1](https://drive.google.com/file/d/1aaeQnh-CbIZRPVj2AAVhhtwejXMoXFVF/view?usp=sharing) |
| আকাইদ ও ফিক্হ | [1](https://drive.google.com/file/d/1rZXMsgGodkpx97ffN7AxCfErZyx6OoZ9/view?usp=sharing) |
| আদ্ দুরূসুল আরাবিয়্যাহ্ | [1](https://drive.google.com/file/d/1eUfP_YuhTlTh5c7WmW-2KfWH1gaw5nL_/view?usp=sharing) |

**২০২৪ শিক্ষাবর্ষের প্রাথমিক স্তরের প্রথম শ্রেণির পাঠ্যপুস্তক** — `/pages/static-pages/6922e049933eb65569e26596`

| Subject | Download link(s) |
|---|---|
| আমার বাংলা বই | [1](https://drive.google.com/file/d/1NoA3Q9xx7iX07tSG098ThYqzawSK5bDK/view?usp=sharing) |
| English for Today | [1](https://drive.google.com/file/d/1D-7tA4aNffHlmQv_cKcDdOZp4uNDXt_F/view?usp=sharing)<br>[2](https://drive.google.com/file/d/1RQiMKxTbTd0Nv40GzeGfILmX5EmIz-2a/view?usp=sharing) |
| প্রাথমিক গণিত | [1](https://drive.google.com/file/d/1hxSTF8h3KZ2lx9OBAiHNUhlG_Azho3v-/view?usp=sharing)<br>[2](https://drive.google.com/file/d/19fHhI4m3aFSoGshkSc0IR9U3Bw52Z9qC/view?usp=sharing) |

**২০২৫ শিক্ষাবর্ষের ইবতেদায়ি স্তরের প্রথম শ্রেণির পাঠ্যপুস্তক** — `/pages/static-pages/6922df72933eb65569e2206f`

| Subject | Download link(s) |
|---|---|
| আমার বাংলা বই | [1](https://drive.google.com/file/d/1MTbykaBdc1bTfeqNN5_W0RzPNlG_EVak/view?usp=drive_link)<br>[2](https://drive.egovcloud.gov.bd/index.php/s/qh7CyjZUc26CFcq) |
| English for Today | [1](https://drive.google.com/file/d/1vLgwbT2DOz8NoVgdZHoSpWvHzYpPPZ-n/view?usp=drive_link)<br>[2](https://drive.egovcloud.gov.bd/index.php/s/DBiiF1MbRgRP9Va) |
| গণিত | [1](https://drive.google.com/file/d/1UZ0x1s4AGar08nVm9ui71cERwv_MB1rk/view?usp=drive_link)<br>[2](https://drive.egovcloud.gov.bd/index.php/s/UNQNDSZaZfWp2bL) |
| কুরআন মাজিদ ও তাজভিদ | [1](https://drive.google.com/file/d/1zf5MIClKLODj3VHOJ90WlziDVUgyUBRk/view?usp=drive_link)<br>[2](https://drive.egovcloud.gov.bd/index.php/s/6ET8TulZwc6BmZO) |
| আকাইদ ও ফিকহ | [1](https://drive.google.com/file/d/1swNHksMRhc0ypKFJ10tAPcbTOZ-EglFE/view?usp=drive_link)<br>[2](https://drive.egovcloud.gov.bd/index.php/s/Uz30EhDnJavibOK) |
| আদদুরুসুল আরাবিয়্যাহ | [1](https://drive.google.com/file/d/1Vll8p6RZUF9kWOnrG0ZDeU9rPvjevHqK/view?usp=drive_link)<br>[2](https://drive.egovcloud.gov.bd/index.php/s/frpwvX26cCCf2Hh) |

**২০২৫ শিক্ষাবর্ষের প্রাথমিক স্তরের প্রথম শ্রেণির পাঠ্যপুস্তক** — `/pages/static-pages/6922dea8933eb65569e1c682`

| Subject | Download link(s) |
|---|---|
| আমার বাংলা বই | [1](http://drive.google.com/file/d/1XFeh1kDvWoBtYza8jft5cwrPVhEcseD5/view?usp=drive_link)<br>[2](https://drive.egovcloud.gov.bd/index.php/s/mwk92EZzEiVcVs7) |
| English for Today | [1](http://drive.google.com/file/d/1fEi4o-cRb-uIuXb0YllOylOLwPKg9003/view?usp=drive_link)<br>[2](https://drive.egovcloud.gov.bd/index.php/s/fSMOWCSv3zSH5pd) |
| প্রাথমিক গণিত | [1](http://drive.google.com/file/d/1sQ9gxdNIKpsBwvbCfOV0Ek6Xmjw90W9B/view?usp=drive_link)<br>[2](https://drive.egovcloud.gov.bd/index.php/s/2ve9vfhXZVLtrBg)<br>[3](http://drive.google.com/file/d/1N6kaGOYkITwR65sKfMBE3JtX9eLgFBSC/view?usp=drive_link)<br>[4](https://drive.egovcloud.gov.bd/index.php/s/w4flCoTsV5CMPk3) |

### G.3 Full catalog — machine-readable file

The complete extraction (all 260 pages with links, all 3,092 links, deduplicated per page in file order) is stored in **`nested_content_links.json`**, an array of `{"path": "...", "links": [...]}` objects keyed by the same paths used in `nested_routes_catalog.json` (Appendix F) — join on `path` to get title + links + hierarchy position for any page in one place.

Representative sample (non–Class 1 pages, to show the range of what §16's decode step recovers):

| Page | Title | Links found |
|---|---|---:|
| `/pages/static-pages/6922dd6c933eb65569e14fcc` | Citizen charter | 5 (2 Object Storage PDFs, 3 Drive) |
| `/pages/static-pages/6922de1d933eb65569e185c0` | Grade 3 teacher guide | 12 (Google Drive, legacy `0B8L6VJQZe3EE...` ID format) |
| `/pages/static-pages/6922de6d933eb65569e1a907` | 2023 teacher diary | 40 (Drive files + Google Docs, largest single page) |
| `/pages/static-pages/6922dfd9933eb65569e244f5` | Annual procurement plan | 3 (1 Object Storage PDF, 2 Drive) |
| `/pages/static-pages/6922df64933eb65569e21ab2` | Application/appeal forms | 14 |
| `/pages/static-pages/6922de84933eb65569e1b39f` | Important documents | 5 (includes a cross-site link to `mof.gov.bd`) |

### G.4 What this means for downloading a book "via API"

There is no dedicated books/textbooks JSON API. The working procedure is:

1. Resolve the page for the book you want from Appendix F (or the mega-menu route family in §16.3) — e.g. Class 1, 2026, primary level → `/pages/static-pages/695b9adec4774958d7b708cd`.
2. `GET` that path as plain HTML.
3. Find `<rt-renderer encoded-content="...">`, base64-decode the attribute (§16.2).
4. Parse the decoded HTML and take the `<a href>` values — these are the real, direct download links (Google Drive view links or `drive.egovcloud.gov.bd` mirrors; occasionally a direct Object Storage PDF).
5. Google Drive `view` links are not raw file bytes — resolve them through Drive's own share/download flow (or use the `drive.egovcloud.gov.bd` mirror where one is given, which is more often a direct-download host).

This 5-step recipe — not a single endpoint — is the real "book download API" for this site.
