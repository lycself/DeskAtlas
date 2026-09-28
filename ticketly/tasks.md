# DeskAtlas tasks

> Check a box when a ticket's acceptance criteria are all met.
> Each ticket shows what it depends on — don't start one until its deps are done.

## EPIC-ARC — Architecture and core rules

- [ ] **ARC-001-Freeze seat state precedence**
  - Effort 2 · Depends on: nothing
  - documents disabled above occupied above pending above available precedence
  - uses the same vocabulary in the API and both web views
  - covers approval, rejection, release, archive, and move transitions
- [ ] **ARC-002-Freeze application identity rules**
  - Effort 2 · Depends on: nothing
  - requires name, student number, full adviser name, school email, enrollment year, program level, and major
  - accepts only email addresses ending in @stu.xmu.edu
  - allows at most one pending application and one active assignment per student number
  - does not require student email verification or expose a tracking link
- [ ] **ARC-003-Define layout editor boundaries**
  - Effort 2 · Depends on: nothing
  - each room auto-fits independently without cross-room scale comparison
  - supports seats, doors, windows, aisles, columns, equipment, and text labels
  - supports draft preview and explicit publication
  - excludes freehand wall drawing and architectural measurement

## EPIC-INF — Environment and deployment

- [ ] **INF-001-Create unified development workspace**
  - Effort 3 · Depends on: ARC-001, ARC-002, ARC-003
  - pnpm dev starts both Next.js and FastAPI
  - the backend runs from a project-root .venv created with Conda py311
  - only pnpm-lock.yaml is used for JavaScript dependencies
  - environment variables are documented without committed secrets
- [ ] **INF-002-Containerize intranet services**
  - Effort 5 · Depends on: INF-001
  - a documented compose command starts the production-shaped stack
  - database data persists across container restarts
  - the public site and API are reachable through one documented intranet origin
  - health checks report database and service readiness

## EPIC-DB — Database and migrations

- [ ] **DB-001-Model rooms and layouts**
  - Effort 5 · Depends on: INF-001, ARC-003
  - room seat codes are unique within a room
  - seat coordinates and dimensions can reproduce the published layout
  - fixtures store validated type and geometry data
  - used rooms and seats can be archived without deleting history
- [ ] **DB-002-Model students and majors**
  - Effort 3 · Depends on: INF-001, ARC-002
  - student numbers remain strings and are unique when present
  - legacy students can omit student number and email and are marked incomplete
  - majors support add, rename, reorder, and deactivate without breaking history
  - the five supplied majors are available as initial data
- [ ] **DB-003-Model applications and assignments**
  - Effort 5 · Depends on: DB-001, DB-002
  - database constraints prevent duplicate active assignments by student or seat
  - database constraints prevent duplicate pending applications by student or seat
  - approval preserves the original submission and the reviewed values
  - moving a student ends the old assignment and creates a new one
- [ ] **DB-004-Model settings and audit history**
  - Effort 3 · Depends on: INF-001
  - SMTP secrets are stored encrypted and never returned through the API
  - delivery attempts record outcome and retry history
  - audited changes include action, timestamp, target, and before-and-after data
- [ ] **DB-005-Create migration and seed path**
  - Effort 3 · Depends on: DB-001, DB-002, DB-003, DB-004
  - one documented command upgrades a blank PostgreSQL database
  - migration rollback is defined for the initial revision
  - seed execution is idempotent
  - the initial major list is present after seeding

## EPIC-AUTH — Administrator authentication

- [ ] **AUTH-001-Implement single-admin login**
  - Effort 3 · Depends on: INF-001
  - plaintext administrator passwords are never stored
  - successful login creates an HttpOnly session
  - logout invalidates the active session
  - repeated failed attempts are rate limited
- [ ] **AUTH-002-Protect administrator operations**
  - Effort 3 · Depends on: AUTH-001
  - unauthenticated requests cannot read private settings or mutate data
  - public room and application endpoints expose only intended fields
  - session cookies use secure production defaults
  - administrator actions are attributable in the audit log

## EPIC-API — Backend workflows

- [ ] **API-004-Manage rooms and layouts**
  - Effort 5 · Depends on: DB-001, AUTH-002
  - supports individual seats and generated row-by-column seat grids
  - supports draft save, preview, and explicit publication
  - blocks destructive deletion when dependent history exists
  - archived rooms disappear from the public catalog
- [ ] **API-006-Manage major reference data**
  - Effort 2 · Depends on: DB-002, AUTH-002
  - active major names are unique
  - renaming updates current display without rewriting historical application snapshots
  - deactivation removes the option from new applications
  - used majors cannot be destructively deleted
- [ ] **API-001-Expose public room catalog**
  - Effort 3 · Depends on: DB-001, DB-003
  - archived and unpublished rooms are excluded
  - every seat includes one derived display state
  - occupant name and academic attributes are returned without contact details
  - list and layout responses derive from the same source records
- [ ] **API-002-Accept student seat applications**
  - Effort 5 · Depends on: DB-003, API-001
  - the year list spans 2020 through the Asia/Shanghai current year plus one
  - the backend rejects invalid school email domains and unsupported program levels or majors
  - concurrent submissions cannot create two pending applications for one seat
  - duplicate pending or already-assigned student numbers receive a clear error
- [ ] **API-003-Review and resolve applications**
  - Effort 5 · Depends on: API-002, AUTH-002
  - review shows both original and editable reviewed values
  - approval creates or updates the student and creates one active assignment
  - rejection accepts an empty reason and releases the pending seat
  - every correction and decision is audited
- [ ] **API-005-Manage students and assignments**
  - Effort 5 · Depends on: DB-003, AUTH-002
  - direct entry can create a complete or explicitly incomplete student
  - movement is blocked when the target is occupied, disabled, archived, or pending review
  - movement closes the previous assignment and creates a new one atomically
  - assignment changes remain visible in student history and the audit log
- [ ] **API-007-Expose operational summaries**
  - Effort 3 · Depends on: API-001, API-003, API-005
  - counts reconcile to the underlying room and assignment records
  - summaries can be filtered by room
  - major and adviser distributions exclude archived assignments by default
  - empty datasets return zeroed results rather than errors

## EPIC-INT — Imports and email

- [ ] **INT-001-Build spreadsheet import preview**
  - Effort 5 · Depends on: API-004, API-005
  - recognizes room, seat, name, adviser, year, program level, major or center, and notes columns
  - normalizes known master and doctoral label variants while reporting ambiguous years
  - identifies equipment-like occupant rows for administrator review
  - does not write database records until the preview is confirmed
- [ ] **INT-002-Commit confirmed spreadsheet import**
  - Effort 5 · Depends on: INT-001
  - the confirmed import runs in one transaction
  - existing room-seat pairs are not duplicated
  - missing student numbers and emails result in incomplete records rather than failure
  - the import result reports created, updated, skipped, and unresolved rows
- [ ] **INT-003-Configure SMTP delivery**
  - Effort 3 · Depends on: DB-004, AUTH-002
  - supports host, port, SSL or STARTTLS, username, password, sender name, and sender address
  - saved passwords are not returned to the browser
  - a test action reports a clear success or failure
  - configuration changes are audited
- [ ] **INT-004-Send decision emails**
  - Effort 3 · Depends on: INT-003, API-003
  - approval email includes the assigned room and seat
  - rejection email includes the reason only when one was supplied
  - a send failure does not roll back the review decision
  - failed deliveries are visible and can be retried by the administrator

## EPIC-WEB — Web experience

- [ ] **WEB-001-Build adaptive glass design system**
  - Effort 5 · Depends on: INF-001
  - supports system, day, and night theme modes and remembers manual choice
  - uses glass effects mainly for navigation, toolbars, overlays, and side panels
  - tables and primary content remain flat and readable
  - reduced-transparency and reduced-motion fallbacks preserve usability
- [ ] **WEB-002-Build public room browser**
  - Effort 5 · Depends on: WEB-001, API-001
  - room selection exposes seat capacity and current availability
  - map and list show consistent seat states and occupant names
  - seat state remains distinguishable without relying on color alone
  - the interface works at desktop and mobile widths
- [ ] **WEB-003-Build student application flow**
  - Effort 5 · Depends on: WEB-002, API-002
  - the adviser prompt requests a full name and warns that inaccurate data may fail review
  - year, program level, and major use the confirmed dynamic or managed options
  - successful submission confirms only that email will carry the decision
  - seat conflicts and duplicate-student errors are explained without losing entered data
- [ ] **WEB-004-Build administrator shell**
  - Effort 3 · Depends on: WEB-001, AUTH-001
  - unauthenticated visitors are redirected to the administrator login
  - navigation reaches applications, rooms, students, imports, majors, mail, and audit views
  - logout clears the session and returns to login
  - the shell works in day and night modes
- [ ] **WEB-005-Build application review workspace**
  - Effort 5 · Depends on: WEB-004, API-003, INT-004
  - selecting an application highlights its requested seat on the room map
  - the administrator can compare original and corrected values
  - rejection reason may be left empty
  - decision and email-delivery outcomes are shown separately
- [ ] **WEB-006-Build room layout editor**
  - Effort 8 · Depends on: WEB-004, API-004
  - a row-by-column dialog generates numbered seats with configurable direction and starting number
  - objects snap to a grid and support multi-select, move, duplicate, rotate, undo, and redo
  - draft changes do not affect the public view until published
  - the administrator can preview the exact student-facing map
- [ ] **WEB-007-Build student assignment workspace**
  - Effort 5 · Depends on: WEB-004, API-005
  - incomplete legacy students can be filtered and completed
  - a target-seat picker excludes occupied, unavailable, archived, and pending seats
  - movement confirmation shows the original and target seat
  - student assignment history is visible
- [ ] **WEB-008-Build settings and audit views**
  - Effort 5 · Depends on: WEB-004, API-006, INT-003
  - major ordering and active state can be changed without exposing destructive actions for used values
  - SMTP password remains masked after saving
  - failed messages expose a retry action
  - audit entries can be filtered by action and target
- [ ] **WEB-009-Build import review workspace**
  - Effort 5 · Depends on: WEB-004, INT-002
  - preview separates valid, normalized, ambiguous, and skipped rows
  - cell colors are not presented as imported meaning
  - ambiguous equipment and year values can be corrected before commit
  - the final report lists created, updated, skipped, and unresolved totals
- [ ] **WEB-010-Build operational overview**
  - Effort 3 · Depends on: WEB-004, API-007
  - primary totals use a flat typographic summary rather than nested cards
  - room occupancy and academic distributions have legible visualizations
  - pending and incomplete counts link to filtered workspaces
  - empty states explain what data is missing

## EPIC-QA — Testing and quality

- [ ] **QA-001-Test backend business rules**
  - Effort 5 · Depends on: API-002, API-003, API-004, API-005, API-006
  - tests cover duplicate student and seat constraints
  - tests cover every seat-state transition
  - tests verify original review data remains immutable
  - tests verify archived and unavailable targets are rejected
- [ ] **QA-002-Test security and email handling**
  - Effort 3 · Depends on: AUTH-002, INT-004
  - protected endpoints reject missing and invalid sessions
  - API responses never expose password hashes, SMTP passwords, or encryption keys
  - failed login throttling is covered
  - email failure leaves the committed approval or rejection unchanged
- [ ] **QA-003-Test spreadsheet migration**
  - Effort 3 · Depends on: INT-002
  - master and doctoral label variants normalize consistently
  - the printer-like row is surfaced for review instead of becoming a student
  - missing student numbers and emails create incomplete records
  - re-importing the same confirmed rows does not duplicate seats
- [ ] **QA-004-Verify responsive visual workflows**
  - Effort 5 · Depends on: WEB-003, WEB-005, WEB-006, WEB-007, WEB-008, WEB-009, WEB-010
  - public room browsing and application complete in both themes
  - administrator review and layout publication complete without clipped controls
  - seat states remain distinguishable without color alone
  - the interface contains no nested-card grids or pervasive pill styling

## EPIC-REL — Release and operations

- [ ] **REL-001-Document administration and recovery**
  - Effort 3 · Depends on: INF-002, WEB-008
  - a clean-machine setup path is documented
  - administrator password rotation steps are documented
  - database backup and restore commands are documented
  - SMTP and import troubleshooting steps are documented
- [ ] **REL-002-Produce verified production build**
  - Effort 5 · Depends on: QA-001, QA-002, QA-003, QA-004, REL-001
  - frontend production build completes without errors
  - backend automated tests pass
  - database migrations apply to a clean PostgreSQL instance
  - documented health, login, browse, apply, review, move, and email smoke checks pass

## EPIC-DESK — Desktop packaging

- [x] **DESK-001-Run the backend on SQLite and migrate real data**
  - Effort 5 · Depends on: DB-005
  - every timestamp column is timezone-aware on both PostgreSQL and SQLite
  - alembic migrations run on a fresh SQLite file and on legacy create_all databases
  - scripts/migrate_to_sqlite.py copies every table with ids intact and exports a backup package
- [x] **DESK-002-Serve the static frontend from FastAPI**
  - Effort 3 · Depends on: DESK-001
  - DESKATLAS_STATIC=1 builds a static export with no server-only features
  - FastAPI maps /a to a.html or a/index.html, serves 404.html, and caches _next/static immutably
  - API and site share one origin so PUBLIC_ORIGIN and CORS are not needed in packaged mode
- [x] **DESK-003-Data directory, setup wizard, and backup packages**
  - Effort 5 · Depends on: DESK-001, DESK-002
  - packaged mode keeps db, config.env, uploads, backups, logs in one data directory
  - first run shows create-admin or restore-from-package before any login
  - admin UI exports, stores, downloads, deletes, and restores backup packages and changes the admin password
  - restore migrates older packages, keeps a pre-restore snapshot, and refuses invalid archives
- [x] **DESK-004-Tray application with status panel**
  - Effort 5 · Depends on: DESK-003
  - closing the panel window hides to the tray; tray exit asks for confirmation
  - panel shows live LAN addresses, QR code, and lets the admin change port, display address, autostart, sleep prevention, auto backup, update source
  - loopback-only panel API; second launch focuses the running instance
- [x] **DESK-005-Installer and release workflow**
  - Effort 5 · Depends on: DESK-004
  - PyInstaller onedir bundle includes the static site and migrations
  - Inno Setup installs per user, adds a program firewall rule with one UAC prompt, offers autostart, keeps data on uninstall
  - GitHub Actions builds and publishes the installer on v* tags
- [x] **DESK-006-Signed online updates**
  - Effort 3 · Depends on: DESK-005
  - release manifest is Ed25519-signed and verified against the embedded public key
  - installer download is verified by sha256 and size before silent install and relaunch
  - update source is configurable for intranet mirrors
