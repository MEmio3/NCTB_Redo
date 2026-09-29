# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Static HTML/CSS/JavaScript; no build step or external runtime dependency. GitHub Pages compatible.

## Users

Developers and technical researchers who need to discover, understand, and test the public HTML/AJAX routes exposed by Bangladesh's National Curriculum and Textbook Board portal.

## Product Purpose

NCTB Endpoints turns the completed API investigation into an searchable operational reference. Success means a visitor can find a route family, understand its response contract, copy an absolute URL, and test a live endpoint without reading the full Markdown investigation.

## Positioning

The site is grounded entirely in verified route data, recursive crawl artifacts, and observed response behavior from nctb.gov.bd; it does not invent an unofficial REST schema.

## Operating Context

Users may browse while building scrapers, integrations, or research tools. The site must work offline from local files and preserve deep-link navigation to sections and endpoint records.

## Capabilities and Constraints

- Public base URL: `https://nctb.gov.bd`.
- Endpoint catalog includes HTML page routes, AJAX JSON routes, static assets, widget contracts, filters, and recursive nested-page routes.
- Browser live checks may be blocked by CORS; the UI must explain that this is expected and show the direct URL fallback.
- The interface must search and filter the route catalog without a backend.
- Route artifacts are point-in-time crawl results and are labeled accordingly.

## Evidence on Hand

- `API_Documentation.md`: complete verified API documentation.
- `nested_routes_catalog.json`: 355 recursively crawled routes.
- `nested_route_graph.json`: route hierarchy and parent relationships.
- `sitemap_paths.txt` and `sitemap_links.tsv`: discovery artifacts.

## Product Principles

1. Make the verified endpoint, not marketing copy, the primary object.
2. Keep every action local, reversible, and understandable.
3. Design for dense technical information without sacrificing readability.
4. Make live response behavior transparent, including expected browser limitations.

## Accessibility & Inclusion

- WCAG 2.2 AA target.
- Full keyboard navigation, visible focus, and semantic controls.
- Works meaningfully at 360px and at high desktop resolutions.
