# CineForge Security Specification (Phase 0 TDD)

## 1. Data Invariants
1. **User Profile Isolation**: `/users/{userId}` contains PII (`email`) and may only be read or modified by `request.auth.uid == userId` with a verified email.
2. **Project Ownership**: Every `/projects/{projectId}` document belongs to exactly one authenticated owner (`ownerId == request.auth.uid`). `ownerId`, `id`, and `createdAt` are immutable after creation.
3. **Subcollection Master Gate**: Every document in `sources`, `assets`, `scripts`, `segments`, `beats`, and `renders` requires the parent `/projects/{projectId}` document to exist and have `ownerId == request.auth.uid` on single-document operations, and carries its own `ownerId` field for secure `allow list` queries without `get()`.
4. **Temporal & Volumetric Integrity**: Every `createdAt` on create and `updatedAt` on update must equal `request.time`. All document IDs match `^[a-zA-Z0-9_\-]+$` (<= 128 chars), and every string and list has explicit upper bounds.
5. **Render Terminal Lock**: Completed render jobs cannot be mutated retroactively to spoof render metadata once finalized (`status == 'completed'`).

## 2. The Dirty Dozen Adversarial Payloads
1. **Unauthenticated Project Read**: `GET /projects/proj_1` with `auth == null` -> `PERMISSION_DENIED`.
2. **Cross-Tenant PII Read**: `GET /users/victim_uid` as `attacker_uid` -> `PERMISSION_DENIED`.
3. **Owner Spoofing on Create**: `CREATE /projects/proj_x` with `ownerId: "victim_uid"` as `attacker_uid` -> `PERMISSION_DENIED`.
4. **Shadow Ghost Field Injection**: `CREATE /projects/proj_x` including undocumented field `isAdmin: true` -> `PERMISSION_DENIED`.
5. **Unverified Email Write**: `CREATE /projects/proj_x` where `auth.token.email_verified == false` -> `PERMISSION_DENIED`.
6. **ID Poisoning**: `CREATE /projects/../../../etc` or 200-char ID -> `PERMISSION_DENIED`.
7. **Timestamp Forgery**: `CREATE /projects/proj_x` with client-forged `createdAt` != `request.time` -> `PERMISSION_DENIED`.
8. **Immutable Field Mutation**: `UPDATE /projects/proj_1` attempting to modify `ownerId` or `createdAt` -> `PERMISSION_DENIED`.
9. **Orphaned Subcollection Write**: `CREATE /projects/nonexistent/assets/a1` -> `PERMISSION_DENIED` (parent project check fails).
10. **Cross-Tenant Subcollection Hijack**: `CREATE /projects/victim_proj/beats/b1` as `attacker_uid` -> `PERMISSION_DENIED`.
11. **Value Poisoning on Update**: `UPDATE /projects/proj_1` setting `title` to a boolean or 500-char string -> `PERMISSION_DENIED`.
12. **Blanket List Scraping**: `LIST /projects` without `where('ownerId', '==', uid)` -> `PERMISSION_DENIED`.
