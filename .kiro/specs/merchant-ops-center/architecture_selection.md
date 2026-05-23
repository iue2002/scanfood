# Architecture Selection: merchant-ops-center

## Recommended Architecture: Hexagonal / Ports-and-Adapters with Explicit Persistence Boundary

### Rationale

This architecture has the lowest information flow density (0.072 vs 0.156 for layered, 0.060 hub-bottlenecked for event-sourced) and the lowest god-object score (~16%, each table owned by a single port). The explicit persistence boundary makes the "existing business untouched" guarantee (R19) a *structural* property — adapters cannot reach into orders/cart/table services even by accident. Round-trip invariants (audit payload, ESC/POS template) become unit-testable on pure cores without Nest or DB infrastructure, directly supporting the user's "完美无瑕" requirement.

The trade-off is increased file count compared to the codebase's existing layered style (Port + Adapter + Core triplets per subdomain). We accept this cost only inside `merchant-ops/` and document the convention; the rest of the repo (orders, tables, dishes) keeps its current layered shape.

### Components

| Component | Owned State | Responsibility |
|-----------|-------------|----------------|
| **EmployeeCore** | none (operates on aggregate snapshots within a transaction) | Pure domain rules: enforce ≥1 Owner & ≤5 Owners (I1, I2), self-protect (I3), password policy (R6.4), token_version monotonicity (I5) |
| **AuthCore** | static `permissionMatrix` (loaded at startup, validated in I10) | Issue/verify JWT, permission-matrix lookup, token_version check (I4), startup matrix coverage validation (R1.3) |
| **AuditCore** | none | Build audit row from request context, enforce 8KB cap + truncation (I8), guarantee JSON round-trip property |
| **NotifPrefCore** | none | Validate `desktop_events ⊆ {NEW_ORDER, ADD_ITEM, REFUND}` (I12), upsert per-user prefs |
| **ExportCore** | export job state machine (in-memory + persisted progress) | Window validation (I20), sync vs streaming threshold (R11.4 vs R11.5), Excel/PDF generation orchestration |
| **PrintCore** | print-job state machine | Template field validation (I15), ESC/POS render (I16), retry schedule (I18), cashier/kitchen split (R16.2) |
| **EmployeeRepoPort + DrizzleEmployeeRepo** | `users` table | All `users` reads/writes incl. row-level lock for owner-count check (R3.4); soft-delete + token_version increment |
| **AuditRepoPort + DrizzleAuditRepo** | `audit_logs`, `audit_logs_archive` | Insert, query (≤90d window I9), nightly archive (R8.5, R8.6) |
| **PrefRepoPort + DrizzlePrefRepo** | `user_preferences` | Per-user upsert, list built-in sounds |
| **PrintRepoPort + DrizzlePrintRepo** | `printer_configs`, `print_templates`, `print_jobs` | All print-domain persistence; AES-256 encrypt `device_key` (I17); 7d job cleanup |
| **ExportArtifactPort + LocalFileSystemAdapter** | files on local disk under `/tmp/exports/{jobId}` | Persist Excel/PDF blobs; 24h auto-cleanup on failure (R11.8) |
| **PrinterDriverPort** + **FeiePrinterAdapter** + **BrowserPrinterAdapter** | none | External print API; FEIE handles cloud printers, Browser path returns HTML for `window.print()` |
| **EventBusPort + WebSocketAdapter** | none | Subscribe to existing `orderStatusChanged` event for auto-print trigger; emit only `mop:` prefixed events to satisfy I22 |
| **MerchantOpsControllers** (5 thin) | none | HTTP-in adapter: DTO validation (I30), DI cores, no business logic |
| **AuditInterceptor (Nest)** | none | Cross-cutting wrapper: after-tx-commit hook → AuditCore.write (I7) |
| **PermissionsGuard (Nest)** | none | Cross-cutting wrapper: reads `@Permissions(action)` metadata, calls AuthCore.check (I11) |
| **JwtAuthGuard (existing, extended)** | none | Add token_version comparison (R5.3); on mismatch → 401 with `code: SESSION_REVOKED` |
| **OpsCenterRoutes (FE)** | route metadata `requiredRole` | React-Router guards; redirect to `/forbidden` on miss (R1.8) |
| **OpsCenterPages (FE)** — `EmployeeListPage`, `NotificationSettingsPage`, `ExportCenterPage`, `PrinterSettingsPage` | local UI state | Each composes existing UI primitives (Card / Button / Switch); no parallel layout shell (R18.5) |
| **useHasPermission Hook (FE)** | none | Reads current user's role from auth store, returns boolean (R1.7) |
| **NotificationCenter (existing, extended)** | `localStorage['mop:notif-pref']` | Loads prefs, plays sound on event, falls back to default sound on load failure (I14), never drops toast/desktop (R10.7) |
| **Sidebar (existing, extended)** | none | Adds 运营中心 menu, role-based visibility (I25, I26) |

### Information Flow

| From \ To | EmpCore | AuthCore | AuditCore | NotifCore | ExportCore | PrintCore | RepoPorts | DriverPorts | EventBusPort | DB |
|-----------|---------|----------|-----------|-----------|------------|-----------|-----------|-------------|--------------|-----|
| **Controllers** | → | → | | → | → | → | | | | |
| **PermissionsGuard** | | → | | | | | | | | |
| **JwtAuthGuard** | | → | | | | | → (read user.token_version) | | | |
| **EmployeeCore** | | | | | | | → | | → (force-logout) | |
| **AuthCore** | | | | | | | → | | | |
| **AuditInterceptor** | | | → (after-tx hook) | | | | | | | |
| **AuditCore** | | | | | | | → | | | |
| **NotifPrefCore** | | | | | | | → | | | |
| **ExportCore** | | | | | | | → (read orders) | → (file write) | | |
| **PrintCore** | | | | | | | → | → (FEIE/Browser) | → (mop:printer-error) | |
| **EventBusPort** | | | | | | ← (callback on orderStatusChanged) | | | | |
| **RepoPorts** | | | | | | | | | | → |

No synchronous cycles. Cores never call each other directly; cross-domain interaction goes through DB or events. The dotted line "EventBusPort ← PrintCore" is the auto-print listener, registered once at module init.

### Requirement Allocation

| Requirement | Component(s) |
|-------------|--------------|
| R1 (RBAC model) | AuthCore + PermissionsGuard + useHasPermission Hook + OpsCenterRoutes |
| R2 (Employee CRUD) | EmployeeCore + EmployeeRepoPort + AuditInterceptor |
| R3 (Owner protection) | EmployeeCore + EmployeeRepoPort (FOR UPDATE lock) |
| R4 (Self-action limits) | EmployeeCore |
| R5 (Forced logout) | EmployeeCore + JwtAuthGuard + EventBusPort |
| R6 (Password mgmt) | EmployeeCore + AuthCore (login response) + EmployeeRepoPort |
| R7 (Audit write) | AuditInterceptor + AuditCore + AuditRepoPort |
| R8 (Audit query/archive) | AuditCore + AuditRepoPort |
| R9 (Sound prefs) | NotifPrefCore + PrefRepoPort + NotificationCenter (FE) |
| R10 (Desktop events + preview) | NotifPrefCore + PrefRepoPort + NotificationCenter (FE) |
| R11 (Excel export) | ExportCore + RepoPorts (read orders) + ExportArtifactPort |
| R12 (PDF report) | ExportCore + RepoPorts + ExportArtifactPort + Puppeteer adapter (under ArtifactPort) |
| R13 (Printer config) | PrintCore + PrintRepoPort + PrinterDriverPort (FeieAdapter for SN/key registration) |
| R14 (Templates) | PrintCore + PrintRepoPort |
| R15 (Test print) | PrintCore + PrintRepoPort + PrinterDriverPort |
| R16 (Auto-print) | PrintCore + EventBusPort (subscribe orderStatusChanged) + PrinterDriverPort |
| R17 (Retry queue) | PrintCore + PrintRepoPort + PrinterDriverPort + EventBusPort (mop:printer-error) |
| R18 (Routes & nav) | OpsCenterRoutes + Sidebar + useHasPermission |
| R19 (Zero-mod existing) | All adapters; structural — RepoPorts cannot reach orders/cart/table tables; EventBusPort whitelists `mop:` events |
| R20 (NFR: perf/sec/obs) | RepoPorts (indexes), all writes via ValidationPipe, env-var secrets, rate limiter middleware on export controllers |
| R21 (Shift placeholder) | OpsCenterPages (FE) — EmployeeListPage renders `<EmployeeShiftSection />` placeholder |

### Key Design-Induced Invariants

These invariants arise from the architectural partitioning, beyond what the requirements directly stated:

1. **DI-1 (Repo isolation)**: Each Core depends only on its own RepoPort interface, never on a concrete repo class or another core's repo. Enforces R19 by construction — `EmployeeCore` cannot accidentally write to `orders` because it does not have an `OrdersRepoPort` injected.
2. **DI-2 (Adapter purity)**: Adapters (FEIE, Browser, Puppeteer, LocalFS) contain *no* business rules. All decisions live in cores. Trade implication: swapping FEIE → another vendor only touches `FeiePrinterAdapter`, never `PrintCore`.
3. **DI-3 (Audit-after-commit)**: AuditInterceptor hooks the *end of the transaction*, not the controller return. This guarantees I7 even when controllers do multi-step composite logic.
4. **DI-4 (Event whitelist)**: WebSocketAdapter exposes only an `emit('mop:*', payload)` method. Trying to emit a non-`mop:` event fails fast at the adapter boundary, satisfying I22.
5. **DI-5 (No cross-core sync calls)**: If `PrintCore` needs employee info, it goes through `EmployeeRepoPort` (read-only projection), never `EmployeeCore.someMethod()`. This eliminates synchronous cycles by construction.
6. **DI-6 (Test boundary)**: Cores are pure TS classes constructed by hand in unit tests with stub ports. This unlocks property-based testing for I8 (audit JSON round-trip), I16 (ESC/POS round-trip), I18 (retry schedule shape).
7. **DI-7 (Read-only existing tables)**: ExportCore reads `orders`, `order_items`, `tables`, `dishes`, `users` through its own dedicated read-port methods that return DTOs, *not* through importing the existing services. This pins R19 — even reads can't accidentally trigger write side-effects of the existing services.

### Alternatives Considered

| Candidate | Strength | Weakness | Why Not Selected |
|-----------|----------|----------|-----------------|
| **C1 Layered (Controller→Service→Repo)** | Matches existing `OrdersService`/`TablesService` style; lowest onboarding friction; fewest files | Higher information flow density (0.156); easy to grow `EmployeeService` into a god object that mixes RBAC + audit + password + session; R19 enforced only by discipline, not structure | The user explicitly demanded "考虑各种边缘问题" and "完美无瑕". Layered style does not provide *structural* protection of the existing business — relying on developer discipline is the wrong trade-off here. |
| **C3 Event-Sourced / CQRS-light with Outbox** | Audit becomes a free side-effect (impossible to forget `@Audit` decorator); exactly-once delivery between DB write and side-effects via outbox; future webhooks/analytics are zero-touch additions | Operational complexity: outbox poller, eventual consistency for read models, debugging is harder; no other module in this codebase uses CQRS — disharmony cost is significant; EventBus becomes a high-fan-out bottleneck (cross-cutting REQs jump to 86%) | For a single-store, 21-REQ feature without distributed-system requirements, the infra complexity is overkill. The hexagonal model captures most of the structural benefits (boundary isolation, testability) without the new mental model. |

### Metrics Summary

| Metric | Selected (C2 Hexagonal) | Alt A (C1 Layered) | Alt B (C3 Event-Sourced) |
|--------|-------------------------|---------------------|---------------------------|
| Cross-cutting reqs % | **62%** | 67% | 86% |
| Cross-cutting invariants % | **23%** | 33% | 40% |
| Flow density | **0.072** | 0.156 | 0.060 (hub) |
| God object score | **~16%** (per-table repo) | ~28% (one service per subdomain) | 0% state but 100% flow throughput on EventBus |
| Sync cycles | **0** | 0 | 0 (async) |
| Max fan-in | **6** (RepoPort) | 7 (DB layer) | 12 (EventBus) |
| Max fan-out | **2** (Core → 1 Repo + 1 EventBus) | 3 (Service → DB + WS + Audit) | 5+ (EventBus fan-out) |
| Evolvability cost | **2.5** components / new REQ | 3.0 components / new REQ | 2.0 + infra learning curve |
