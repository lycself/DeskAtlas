# DeskAtlas backlog

10 epics · 45 tickets · 182 points

## Your plan

**Where to start:** ARC-001-Freeze seat state precedence.

**Start today** — nothing is blocking these:

- ARC-001-Freeze seat state precedence
- ARC-002-Freeze application identity rules
- ARC-003-Define layout editor boundaries

**Comes after** — each of these waits on something above:

- INF-001-Create unified development workspace (waits on ARC-001, ARC-002, ARC-003)
- AUTH-001-Implement single-admin login (waits on INF-001)
- AUTH-002-Protect administrator operations (waits on AUTH-001)
- DB-001-Model rooms and layouts (waits on INF-001, ARC-003)
- API-004-Manage rooms and layouts (waits on DB-001, AUTH-002)
- DB-002-Model students and majors (waits on INF-001, ARC-002)
- API-006-Manage major reference data (waits on DB-002, AUTH-002)
- DB-003-Model applications and assignments (waits on DB-001, DB-002)
- API-001-Expose public room catalog (waits on DB-001, DB-003)
- API-002-Accept student seat applications (waits on DB-003, API-001)
- API-003-Review and resolve applications (waits on API-002, AUTH-002)
- API-005-Manage students and assignments (waits on DB-003, AUTH-002)
- API-007-Expose operational summaries (waits on API-001, API-003, API-005)
- DB-004-Model settings and audit history (waits on INF-001)
- DB-005-Create migration and seed path (waits on DB-001, DB-002, DB-003, DB-004)
- INF-002-Containerize intranet services (waits on INF-001)
- INT-001-Build spreadsheet import preview (waits on API-004, API-005)
- INT-002-Commit confirmed spreadsheet import (waits on INT-001)
- INT-003-Configure SMTP delivery (waits on DB-004, AUTH-002)
- INT-004-Send decision emails (waits on INT-003, API-003)
- QA-001-Test backend business rules (waits on API-002, API-003, API-004, API-005, API-006)
- QA-002-Test security and email handling (waits on AUTH-002, INT-004)
- QA-003-Test spreadsheet migration (waits on INT-002)
- WEB-001-Build adaptive glass design system (waits on INF-001)
- WEB-002-Build public room browser (waits on WEB-001, API-001)
- WEB-003-Build student application flow (waits on WEB-002, API-002)
- WEB-004-Build administrator shell (waits on WEB-001, AUTH-001)
- WEB-005-Build application review workspace (waits on WEB-004, API-003, INT-004)
- WEB-006-Build room layout editor (waits on WEB-004, API-004)
- WEB-007-Build student assignment workspace (waits on WEB-004, API-005)
- WEB-008-Build settings and audit views (waits on WEB-004, API-006, INT-003)
- REL-001-Document administration and recovery (waits on INF-002, WEB-008)
- WEB-009-Build import review workspace (waits on WEB-004, INT-002)
- WEB-010-Build operational overview (waits on WEB-004, API-007)
- QA-004-Verify responsive visual workflows (waits on WEB-003, WEB-005, WEB-006, WEB-007, WEB-008, WEB-009, WEB-010)
- REL-002-Produce verified production build (waits on QA-001, QA-002, QA-003, QA-004, REL-001)

**How big each area is:**

- EPIC-ARC — Architecture and core rules: medium (3 tickets)
- EPIC-INF — Environment and deployment: medium (2 tickets)
- EPIC-DB — Database and migrations: large (5 tickets)
- EPIC-AUTH — Administrator authentication: medium (2 tickets)
- EPIC-API — Backend workflows: large (7 tickets)
- EPIC-INT — Imports and email: large (4 tickets)
- EPIC-WEB — Web experience: large (10 tickets)
- EPIC-QA — Testing and quality: large (4 tickets)
- EPIC-REL — Release and operations: medium (2 tickets)
- EPIC-DESK — Desktop packaging: large (6 tickets)

## EPIC-ARC — Architecture and core rules

Establish the shared product rules and boundaries every DeskAtlas workflow relies on.

| ID | Title | Effort | Dependencies | Status |
| --- | --- | --- | --- | --- |
| ARC-001 | Freeze seat state precedence | 2 | — | To Do |
| ARC-002 | Freeze application identity rules | 2 | — | To Do |
| ARC-003 | Define layout editor boundaries | 2 | — | To Do |

**ARC-001 acceptance criteria**
- documents disabled above occupied above pending above available precedence
- uses the same vocabulary in the API and both web views
- covers approval, rejection, release, archive, and move transitions

**ARC-002 acceptance criteria**
- requires name, student number, full adviser name, school email, enrollment year, program level, and major
- accepts only email addresses ending in @stu.xmu.edu
- allows at most one pending application and one active assignment per student number
- does not require student email verification or expose a tracking link

**ARC-003 acceptance criteria**
- each room auto-fits independently without cross-room scale comparison
- supports seats, doors, windows, aisles, columns, equipment, and text labels
- supports draft preview and explicit publication
- excludes freehand wall drawing and architectural measurement

## EPIC-INF — Environment and deployment

Make the full application reproducible locally and deployable on the target intranet.

| ID | Title | Effort | Dependencies | Status |
| --- | --- | --- | --- | --- |
| INF-001 | Create unified development workspace | 3 | ARC-001, ARC-002, ARC-003 | To Do |
| INF-002 | Containerize intranet services | 5 | INF-001 | To Do |

**INF-001 acceptance criteria**
- pnpm dev starts both Next.js and FastAPI
- the backend runs from a project-root .venv created with Conda py311
- only pnpm-lock.yaml is used for JavaScript dependencies
- environment variables are documented without committed secrets

**INF-002 acceptance criteria**
- a documented compose command starts the production-shaped stack
- database data persists across container restarts
- the public site and API are reachable through one documented intranet origin
- health checks report database and service readiness

## EPIC-DB — Database and migrations

Create an auditable PostgreSQL model for rooms, people, workflows, settings, and history.

| ID | Title | Effort | Dependencies | Status |
| --- | --- | --- | --- | --- |
| DB-001 | Model rooms and layouts | 5 | INF-001, ARC-003 | To Do |
| DB-002 | Model students and majors | 3 | INF-001, ARC-002 | To Do |
| DB-003 | Model applications and assignments | 5 | DB-001, DB-002 | To Do |
| DB-004 | Model settings and audit history | 3 | INF-001 | To Do |
| DB-005 | Create migration and seed path | 3 | DB-001, DB-002, DB-003, DB-004 | To Do |

**DB-001 acceptance criteria**
- room seat codes are unique within a room
- seat coordinates and dimensions can reproduce the published layout
- fixtures store validated type and geometry data
- used rooms and seats can be archived without deleting history

**DB-002 acceptance criteria**
- student numbers remain strings and are unique when present
- legacy students can omit student number and email and are marked incomplete
- majors support add, rename, reorder, and deactivate without breaking history
- the five supplied majors are available as initial data

**DB-003 acceptance criteria**
- database constraints prevent duplicate active assignments by student or seat
- database constraints prevent duplicate pending applications by student or seat
- approval preserves the original submission and the reviewed values
- moving a student ends the old assignment and creates a new one

**DB-004 acceptance criteria**
- SMTP secrets are stored encrypted and never returned through the API
- delivery attempts record outcome and retry history
- audited changes include action, timestamp, target, and before-and-after data

**DB-005 acceptance criteria**
- one documented command upgrades a blank PostgreSQL database
- migration rollback is defined for the initial revision
- seed execution is idempotent
- the initial major list is present after seeding

## EPIC-AUTH — Administrator authentication

Protect administration with one environment-configured account and secure sessions.

| ID | Title | Effort | Dependencies | Status |
| --- | --- | --- | --- | --- |
| AUTH-001 | Implement single-admin login | 3 | INF-001 | To Do |
| AUTH-002 | Protect administrator operations | 3 | AUTH-001 | To Do |

**AUTH-001 acceptance criteria**
- plaintext administrator passwords are never stored
- successful login creates an HttpOnly session
- logout invalidates the active session
- repeated failed attempts are rate limited

**AUTH-002 acceptance criteria**
- unauthenticated requests cannot read private settings or mutate data
- public room and application endpoints expose only intended fields
- session cookies use secure production defaults
- administrator actions are attributable in the audit log

## EPIC-API — Backend workflows

Expose the transactional room, application, approval, and assignment workflows used by both interfaces.

| ID | Title | Effort | Dependencies | Status |
| --- | --- | --- | --- | --- |
| API-001 | Expose public room catalog | 3 | DB-001, DB-003 | To Do |
| API-002 | Accept student seat applications | 5 | DB-003, API-001 | To Do |
| API-003 | Review and resolve applications | 5 | API-002, AUTH-002 | To Do |
| API-004 | Manage rooms and layouts | 5 | DB-001, AUTH-002 | To Do |
| API-005 | Manage students and assignments | 5 | DB-003, AUTH-002 | To Do |
| API-006 | Manage major reference data | 2 | DB-002, AUTH-002 | To Do |
| API-007 | Expose operational summaries | 3 | API-001, API-003, API-005 | To Do |

**API-001 acceptance criteria**
- archived and unpublished rooms are excluded
- every seat includes one derived display state
- occupant name and academic attributes are returned without contact details
- list and layout responses derive from the same source records

**API-002 acceptance criteria**
- the year list spans 2020 through the Asia/Shanghai current year plus one
- the backend rejects invalid school email domains and unsupported program levels or majors
- concurrent submissions cannot create two pending applications for one seat
- duplicate pending or already-assigned student numbers receive a clear error

**API-003 acceptance criteria**
- review shows both original and editable reviewed values
- approval creates or updates the student and creates one active assignment
- rejection accepts an empty reason and releases the pending seat
- every correction and decision is audited

**API-004 acceptance criteria**
- supports individual seats and generated row-by-column seat grids
- supports draft save, preview, and explicit publication
- blocks destructive deletion when dependent history exists
- archived rooms disappear from the public catalog

**API-005 acceptance criteria**
- direct entry can create a complete or explicitly incomplete student
- movement is blocked when the target is occupied, disabled, archived, or pending review
- movement closes the previous assignment and creates a new one atomically
- assignment changes remain visible in student history and the audit log

**API-006 acceptance criteria**
- active major names are unique
- renaming updates current display without rewriting historical application snapshots
- deactivation removes the option from new applications
- used majors cannot be destructively deleted

**API-007 acceptance criteria**
- counts reconcile to the underlying room and assignment records
- summaries can be filtered by room
- major and adviser distributions exclude archived assignments by default
- empty datasets return zeroed results rather than errors

## EPIC-INT — Imports and email

Bring legacy spreadsheet data into DeskAtlas and deliver approval outcomes through administrator-managed SMTP.

| ID | Title | Effort | Dependencies | Status |
| --- | --- | --- | --- | --- |
| INT-001 | Build spreadsheet import preview | 5 | API-004, API-005 | To Do |
| INT-002 | Commit confirmed spreadsheet import | 5 | INT-001 | To Do |
| INT-003 | Configure SMTP delivery | 3 | DB-004, AUTH-002 | To Do |
| INT-004 | Send decision emails | 3 | INT-003, API-003 | To Do |

**INT-001 acceptance criteria**
- recognizes room, seat, name, adviser, year, program level, major or center, and notes columns
- normalizes known master and doctoral label variants while reporting ambiguous years
- identifies equipment-like occupant rows for administrator review
- does not write database records until the preview is confirmed

**INT-002 acceptance criteria**
- the confirmed import runs in one transaction
- existing room-seat pairs are not duplicated
- missing student numbers and emails result in incomplete records rather than failure
- the import result reports created, updated, skipped, and unresolved rows

**INT-003 acceptance criteria**
- supports host, port, SSL or STARTTLS, username, password, sender name, and sender address
- saved passwords are not returned to the browser
- a test action reports a clear success or failure
- configuration changes are audited

**INT-004 acceptance criteria**
- approval email includes the assigned room and seat
- rejection email includes the reason only when one was supplied
- a send failure does not roll back the review decision
- failed deliveries are visible and can be retried by the administrator

## EPIC-WEB — Web experience

Deliver the public seat experience and complete administrator workspace in a restrained liquid-glass visual system.

| ID | Title | Effort | Dependencies | Status |
| --- | --- | --- | --- | --- |
| WEB-001 | Build adaptive glass design system | 5 | INF-001 | To Do |
| WEB-002 | Build public room browser | 5 | WEB-001, API-001 | To Do |
| WEB-003 | Build student application flow | 5 | WEB-002, API-002 | To Do |
| WEB-004 | Build administrator shell | 3 | WEB-001, AUTH-001 | To Do |
| WEB-005 | Build application review workspace | 5 | WEB-004, API-003, INT-004 | To Do |
| WEB-006 | Build room layout editor | 8 | WEB-004, API-004 | To Do |
| WEB-007 | Build student assignment workspace | 5 | WEB-004, API-005 | To Do |
| WEB-008 | Build settings and audit views | 5 | WEB-004, API-006, INT-003 | To Do |
| WEB-009 | Build import review workspace | 5 | WEB-004, INT-002 | To Do |
| WEB-010 | Build operational overview | 3 | WEB-004, API-007 | To Do |

**WEB-001 acceptance criteria**
- supports system, day, and night theme modes and remembers manual choice
- uses glass effects mainly for navigation, toolbars, overlays, and side panels
- tables and primary content remain flat and readable
- reduced-transparency and reduced-motion fallbacks preserve usability

**WEB-002 acceptance criteria**
- room selection exposes seat capacity and current availability
- map and list show consistent seat states and occupant names
- seat state remains distinguishable without relying on color alone
- the interface works at desktop and mobile widths

**WEB-003 acceptance criteria**
- the adviser prompt requests a full name and warns that inaccurate data may fail review
- year, program level, and major use the confirmed dynamic or managed options
- successful submission confirms only that email will carry the decision
- seat conflicts and duplicate-student errors are explained without losing entered data

**WEB-004 acceptance criteria**
- unauthenticated visitors are redirected to the administrator login
- navigation reaches applications, rooms, students, imports, majors, mail, and audit views
- logout clears the session and returns to login
- the shell works in day and night modes

**WEB-005 acceptance criteria**
- selecting an application highlights its requested seat on the room map
- the administrator can compare original and corrected values
- rejection reason may be left empty
- decision and email-delivery outcomes are shown separately

**WEB-006 acceptance criteria**
- a row-by-column dialog generates numbered seats with configurable direction and starting number
- objects snap to a grid and support multi-select, move, duplicate, rotate, undo, and redo
- draft changes do not affect the public view until published
- the administrator can preview the exact student-facing map

**WEB-007 acceptance criteria**
- incomplete legacy students can be filtered and completed
- a target-seat picker excludes occupied, unavailable, archived, and pending seats
- movement confirmation shows the original and target seat
- student assignment history is visible

**WEB-008 acceptance criteria**
- major ordering and active state can be changed without exposing destructive actions for used values
- SMTP password remains masked after saving
- failed messages expose a retry action
- audit entries can be filtered by action and target

**WEB-009 acceptance criteria**
- preview separates valid, normalized, ambiguous, and skipped rows
- cell colors are not presented as imported meaning
- ambiguous equipment and year values can be corrected before commit
- the final report lists created, updated, skipped, and unresolved totals

**WEB-010 acceptance criteria**
- primary totals use a flat typographic summary rather than nested cards
- room occupancy and academic distributions have legible visualizations
- pending and incomplete counts link to filtered workspaces
- empty states explain what data is missing

## EPIC-QA — Testing and quality

Verify the transactional rules, security boundaries, imports, visual workflows, and production build.

| ID | Title | Effort | Dependencies | Status |
| --- | --- | --- | --- | --- |
| QA-001 | Test backend business rules | 5 | API-002, API-003, API-004, API-005, API-006 | To Do |
| QA-002 | Test security and email handling | 3 | AUTH-002, INT-004 | To Do |
| QA-003 | Test spreadsheet migration | 3 | INT-002 | To Do |
| QA-004 | Verify responsive visual workflows | 5 | WEB-003, WEB-005, WEB-006, WEB-007, WEB-008, WEB-009, WEB-010 | To Do |

**QA-001 acceptance criteria**
- tests cover duplicate student and seat constraints
- tests cover every seat-state transition
- tests verify original review data remains immutable
- tests verify archived and unavailable targets are rejected

**QA-002 acceptance criteria**
- protected endpoints reject missing and invalid sessions
- API responses never expose password hashes, SMTP passwords, or encryption keys
- failed login throttling is covered
- email failure leaves the committed approval or rejection unchanged

**QA-003 acceptance criteria**
- master and doctoral label variants normalize consistently
- the printer-like row is surfaced for review instead of becoming a student
- missing student numbers and emails create incomplete records
- re-importing the same confirmed rows does not duplicate seats

**QA-004 acceptance criteria**
- public room browsing and application complete in both themes
- administrator review and layout publication complete without clipped controls
- seat states remain distinguishable without color alone
- the interface contains no nested-card grids or pervasive pill styling

## EPIC-REL — Release and operations

Document, build, and verify the complete DeskAtlas deployment for handoff.

| ID | Title | Effort | Dependencies | Status |
| --- | --- | --- | --- | --- |
| REL-001 | Document administration and recovery | 3 | INF-002, WEB-008 | To Do |
| REL-002 | Produce verified production build | 5 | QA-001, QA-002, QA-003, QA-004, REL-001 | To Do |

**REL-001 acceptance criteria**
- a clean-machine setup path is documented
- administrator password rotation steps are documented
- database backup and restore commands are documented
- SMTP and import troubleshooting steps are documented

**REL-002 acceptance criteria**
- frontend production build completes without errors
- backend automated tests pass
- database migrations apply to a clean PostgreSQL instance
- documented health, login, browse, apply, review, move, and email smoke checks pass

## Build order

Work tickets top to bottom; each ticket's dependencies come before it.

1. ARC-001-Freeze seat state precedence
2. ARC-002-Freeze application identity rules
3. ARC-003-Define layout editor boundaries
4. INF-001-Create unified development workspace
5. AUTH-001-Implement single-admin login
6. AUTH-002-Protect administrator operations
7. DB-001-Model rooms and layouts
8. API-004-Manage rooms and layouts
9. DB-002-Model students and majors
10. API-006-Manage major reference data
11. DB-003-Model applications and assignments
12. API-001-Expose public room catalog
13. API-002-Accept student seat applications
14. API-003-Review and resolve applications
15. API-005-Manage students and assignments
16. API-007-Expose operational summaries
17. DB-004-Model settings and audit history
18. DB-005-Create migration and seed path
19. INF-002-Containerize intranet services
20. INT-001-Build spreadsheet import preview
21. INT-002-Commit confirmed spreadsheet import
22. INT-003-Configure SMTP delivery
23. INT-004-Send decision emails
24. QA-001-Test backend business rules
25. QA-002-Test security and email handling
26. QA-003-Test spreadsheet migration
27. WEB-001-Build adaptive glass design system
28. WEB-002-Build public room browser
29. WEB-003-Build student application flow
30. WEB-004-Build administrator shell
31. WEB-005-Build application review workspace
32. WEB-006-Build room layout editor
33. WEB-007-Build student assignment workspace
34. WEB-008-Build settings and audit views
35. REL-001-Document administration and recovery
36. WEB-009-Build import review workspace
37. WEB-010-Build operational overview
38. QA-004-Verify responsive visual workflows
39. REL-002-Produce verified production build

## EPIC-DESK — Desktop packaging

Ship DeskAtlas as a Windows tray application with SQLite storage, portable backups, and signed online updates, so the administrator's own PC can serve the department without a server.

| ID | Title | Effort | Dependencies | Status |
| --- | --- | --- | --- | --- |
| DESK-001 | Run the backend on SQLite and migrate real data | 5 | DB-005 | Done |
| DESK-002 | Serve the static frontend from FastAPI | 3 | DESK-001 | Done |
| DESK-003 | Data directory, setup wizard, and backup packages | 5 | DESK-001, DESK-002 | Done |
| DESK-004 | Tray application with status panel | 5 | DESK-003 | Done |
| DESK-005 | Installer and release workflow | 5 | DESK-004 | Done |
| DESK-006 | Signed online updates | 3 | DESK-005 | Done |

**DESK-001 acceptance criteria**
- every timestamp column is timezone-aware on both PostgreSQL and SQLite
- alembic migrations run on a fresh SQLite file and on legacy create_all databases
- scripts/migrate_to_sqlite.py copies every table with ids intact and exports a backup package

**DESK-002 acceptance criteria**
- DESKATLAS_STATIC=1 builds a static export with no server-only features
- FastAPI maps /a to a.html or a/index.html, serves 404.html, and caches _next/static immutably
- API and site share one origin so PUBLIC_ORIGIN and CORS are not needed in packaged mode

**DESK-003 acceptance criteria**
- packaged mode keeps db, config.env, uploads, backups, logs in one data directory
- first run shows create-admin or restore-from-package before any login
- admin UI exports, stores, downloads, deletes, and restores backup packages and changes the admin password
- restore migrates older packages, keeps a pre-restore snapshot, and refuses invalid archives

**DESK-004 acceptance criteria**
- closing the panel window hides to the tray; tray exit asks for confirmation
- panel shows live LAN addresses, QR code, and lets the admin change port, display address, autostart, sleep prevention, auto backup, update source
- loopback-only panel API; second launch focuses the running instance

**DESK-005 acceptance criteria**
- PyInstaller onedir bundle includes the static site and migrations
- Inno Setup installs per user, adds a program firewall rule with one UAC prompt, offers autostart, keeps data on uninstall
- GitHub Actions builds and publishes the installer on v* tags

**DESK-006 acceptance criteria**
- release manifest is Ed25519-signed and verified against the embedded public key
- installer download is verified by sha256 and size before silent install and relaunch
- update source is configurable for intranet mirrors
