import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from './firebase';
import type {
  ArchivalAsset,
  NarrationSegment,
  Project,
  RenderJob,
  ResearchSource,
  ScriptVersion,
  StoryboardBeat,
} from '../types/cineforge';

export function makeSafeId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const ts = Date.now().toString(36);
  return `${prefix}_${ts}_${rand}`.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
}

function stripUndefinedValue(v: any): any {
  if (Array.isArray(v)) {
    return v.filter((item) => item !== undefined).map((item) => stripUndefinedValue(item));
  }
  if (v && typeof v === 'object' && !(v instanceof Date) && !('_methodName' in v)) {
    return stripUndefined(v);
  }
  return v;
}

function stripUndefined<T extends Record<string, any>>(obj: T): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) {
      out[k] = stripUndefinedValue(v);
    }
  }
  return out;
}

function clampString(val: string | undefined, maxLen: number): string | undefined {
  if (val === undefined) return undefined;
  return val.slice(0, maxLen);
}

export async function upsertUserProfile(): Promise<void> {
  const user = auth.currentUser;
  if (!user || !user.email) return;
  const path = `users/${user.uid}`;
  try {
    const ref = doc(db, 'users', user.uid);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        uid: user.uid,
        email: user.email.slice(0, 254),
        displayName: (user.displayName || user.email.split('@')[0]).slice(0, 120),
        ...(user.photoURL ? { photoURL: user.photoURL.slice(0, 1000) } : {}),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        email: user.email.slice(0, 254),
        displayName: (user.displayName || user.email.split('@')[0]).slice(0, 120),
        ...(user.photoURL ? { photoURL: user.photoURL.slice(0, 1000) } : {}),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export function subscribeUserProjects(
  uid: string,
  onData: (projects: Project[]) => void
): () => void {
  const q = query(
    collection(db, 'projects'),
    where('ownerId', '==', uid)
  );
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs
        .map((d) => d.data() as Project)
        .sort((a, b) => {
          const ta = a.updatedAt?.toMillis?.() ?? 0;
          const tb = b.updatedAt?.toMillis?.() ?? 0;
          return tb - ta;
        });
      onData(list);
    },
    (error) => handleFirestoreError(error, OperationType.LIST, 'projects')
  );
}

function sanitizeProjectFields<T extends Partial<Project>>(data: T): T {
  const out: Record<string, any> = { ...data };
  if (typeof out.title === 'string') out.title = out.title.trim().slice(0, 200) || 'Untitled Documentary';
  if (typeof out.topic === 'string') out.topic = out.topic.slice(0, 4000);
  if (typeof out.language === 'string') out.language = out.language.slice(0, 60);
  if (typeof out.narratorLanguage === 'string') out.narratorLanguage = out.narratorLanguage.slice(0, 60);
  if (typeof out.narratorAccent === 'string') out.narratorAccent = out.narratorAccent.slice(0, 120);
  if (typeof out.voiceCharacter === 'string') out.voiceCharacter = out.voiceCharacter.slice(0, 120);
  if (typeof out.aspectRatio === 'string') out.aspectRatio = out.aspectRatio.slice(0, 20);
  if (typeof out.resolution === 'string') out.resolution = out.resolution.slice(0, 30);
  if (typeof out.visualStyle === 'string') out.visualStyle = out.visualStyle.slice(0, 500);
  if (typeof out.thumbnailUrl === 'string') out.thumbnailUrl = out.thumbnailUrl.slice(0, 1000);
  if (typeof out.researchSummary === 'string') out.researchSummary = out.researchSummary.slice(0, 20000);
  if (typeof out.researchPreferences === 'string') out.researchPreferences = out.researchPreferences.slice(0, 4000);
  if (typeof out.animatedRigsScriptHash === 'string') out.animatedRigsScriptHash = out.animatedRigsScriptHash.slice(0, 128);
  if (typeof out.mediaFulfilledHash === 'string') out.mediaFulfilledHash = out.mediaFulfilledHash.slice(0, 128);
  if (Array.isArray(out.uploadedReferences)) out.uploadedReferences = out.uploadedReferences.slice(0, 25);
  return out as T;
}

export async function createProjectDoc(
  input: Omit<Project, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'>
): Promise<Project> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Not signed in');
  const id = makeSafeId('proj');
  const path = `projects/${id}`;
  const sanitized = sanitizeProjectFields(input);
  const payload = stripUndefined({
    ...sanitized,
    id,
    ownerId: uid,
    title: clampString(sanitized.title, 200) || 'Untitled Documentary',
    topic: clampString(sanitized.topic, 4000) || '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  try {
    await setDoc(doc(db, 'projects', id), payload);
    return { ...sanitized, id, ownerId: uid };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateProjectDoc(
  projectId: string,
  patch: Partial<Project>
): Promise<void> {
  const path = `projects/${projectId}`;
  const sanitized = sanitizeProjectFields(patch);
  const cleanPatch = stripUndefined({
    ...sanitized,
    updatedAt: serverTimestamp(),
  });
  delete cleanPatch.id;
  delete cleanPatch.ownerId;
  delete cleanPatch.createdAt;

  try {
    await updateDoc(doc(db, 'projects', projectId), cleanPatch);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function duplicateProjectDoc(source: Project): Promise<Project> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Not signed in');
  const { id: _oldId, ownerId: _oldOwner, createdAt: _c, updatedAt: _u, ...rest } = source;
  const newProj = await createProjectDoc({
    ...rest,
    title: `${source.title} (Copy)`.slice(0, 200),
    status: 'draft',
    renderStatus: 'idle',
  });

  // Duplicate subcollections (sources, assets, scripts, segments, beats)
  const subcollections = ['sources', 'assets', 'scripts', 'segments', 'beats'] as const;
  for (const sub of subcollections) {
    const snap = await getDocs(
      query(collection(db, 'projects', source.id, sub), where('ownerId', '==', uid))
    );
    if (!snap.empty) {
      const batch = writeBatch(db);
      snap.docs.forEach((d) => {
        const data = d.data();
        const newDocId = makeSafeId(sub.slice(0, 3));
        const clone = stripUndefined({
          ...data,
          id: newDocId,
          projectId: newProj.id,
          ownerId: uid,
          createdAt: serverTimestamp(),
          ...(sub !== 'sources' ? { updatedAt: serverTimestamp() } : {}),
        });
        batch.set(doc(db, 'projects', newProj.id, sub, newDocId), clone);
      });
      await batch.commit();
    }
  }
  return newProj;
}

export async function deleteProjectDoc(projectId: string): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Not signed in');
  const path = `projects/${projectId}`;
  try {
    const subs = ['sources', 'assets', 'scripts', 'segments', 'beats', 'renders'];
    for (const sub of subs) {
      const snap = await getDocs(
        query(collection(db, 'projects', projectId, sub), where('ownerId', '==', uid))
      );
      if (!snap.empty) {
        const batch = writeBatch(db);
        snap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }
    }
    await deleteDoc(doc(db, 'projects', projectId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// --- Subcollection Listeners & Writers ---

export function subscribeProjectSubcollection<T>(
  projectId: string,
  uid: string,
  sub: 'sources' | 'assets' | 'scripts' | 'segments' | 'beats' | 'renders',
  onData: (items: T[]) => void,
  sortFn?: (a: T, b: T) => number
): () => void {
  const path = `projects/${projectId}/${sub}`;
  const q = query(collection(db, 'projects', projectId, sub), where('ownerId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      let items = snap.docs.map((d) => d.data() as T);
      if (sortFn) items = [...items].sort(sortFn);
      onData(items);
    },
    (error) => handleFirestoreError(error, OperationType.LIST, path)
  );
}

export async function saveResearchSources(
  projectId: string,
  sources: Array<Omit<ResearchSource, 'id' | 'ownerId' | 'projectId' | 'createdAt'>>
): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Not signed in');
  const path = `projects/${projectId}/sources`;
  try {
    const batch = writeBatch(db);
    for (const s of sources) {
      const id = makeSafeId('src');
      batch.set(
        doc(db, 'projects', projectId, 'sources', id),
        stripUndefined({
          id,
          ownerId: uid,
          projectId,
          title: clampString(s.title, 300) || 'Verified Source',
          url: clampString(s.url, 1000) || '',
          publisher: clampString(s.publisher, 160),
          sourceType: clampString(s.sourceType, 60),
          summary: clampString(s.summary, 3000),
          dateRange: clampString(s.dateRange, 80),
          createdAt: serverTimestamp(),
        })
      );
    }
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function saveAssetsBatch(
  projectId: string,
  assets: Array<Omit<ArchivalAsset, 'id' | 'ownerId' | 'projectId' | 'createdAt' | 'updatedAt'>>
): Promise<ArchivalAsset[]> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Not signed in');
  const path = `projects/${projectId}/assets`;
  const created: ArchivalAsset[] = [];
  try {
    const batch = writeBatch(db);
    for (const a of assets) {
      const id = makeSafeId('ast');
      const record: ArchivalAsset = {
        ...a,
        id,
        ownerId: uid,
        projectId,
        title: clampString(a.title, 300) || 'Archival Asset',
        description: clampString(a.description, 2000),
        sourceUrl: clampString(a.sourceUrl, 1200),
        imageUrl: clampString(a.imageUrl, 1200),
        videoUrl: clampString(a.videoUrl, 1200),
        thumbnailUrl: clampString(a.thumbnailUrl, 1200),
        creator: clampString(a.creator, 300),
        license: clampString(a.license, 200),
        assignedSegmentId: clampString(a.assignedSegmentId, 128),
        assignedBeatId: clampString(a.assignedBeatId, 128),
        limitationNote: clampString(a.limitationNote, 600),
      };
      created.push(record);
      batch.set(
        doc(db, 'projects', projectId, 'assets', id),
        stripUndefined({
          ...record,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );
    }
    await batch.commit();
    return created;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateAssetDoc(
  projectId: string,
  assetId: string,
  patch: Partial<ArchivalAsset>
): Promise<void> {
  const path = `projects/${projectId}/assets/${assetId}`;
  const clean = stripUndefined({
    ...patch,
    updatedAt: serverTimestamp(),
  });
  delete clean.id;
  delete clean.ownerId;
  delete clean.projectId;
  delete clean.createdAt;
  try {
    await updateDoc(doc(db, 'projects', projectId, 'assets', assetId), clean);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteAssetDoc(projectId: string, assetId: string): Promise<void> {
  const path = `projects/${projectId}/assets/${assetId}`;
  try {
    await deleteDoc(doc(db, 'projects', projectId, 'assets', assetId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function createScriptVersionDoc(
  projectId: string,
  script: Omit<ScriptVersion, 'id' | 'ownerId' | 'projectId' | 'createdAt' | 'updatedAt'>,
  existingScripts: ScriptVersion[]
): Promise<ScriptVersion> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Not signed in');
  const id = makeSafeId('scr');
  const path = `projects/${projectId}/scripts/${id}`;
  try {
    const batch = writeBatch(db);
    for (const prev of existingScripts) {
      if (prev.isActive) {
        batch.update(doc(db, 'projects', projectId, 'scripts', prev.id), {
          isActive: false,
          updatedAt: serverTimestamp(),
        });
      }
    }
    const record: ScriptVersion = {
      ...script,
      id,
      ownerId: uid,
      projectId,
      label: clampString(script.label, 160),
    };
    batch.set(
      doc(db, 'projects', projectId, 'scripts', id),
      stripUndefined({
        ...record,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
    await batch.commit();
    return record;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateScriptVersionDoc(
  projectId: string,
  scriptId: string,
  patch: Partial<ScriptVersion>
): Promise<void> {
  const path = `projects/${projectId}/scripts/${scriptId}`;
  const clean = stripUndefined({ ...patch, updatedAt: serverTimestamp() });
  delete clean.id;
  delete clean.ownerId;
  delete clean.projectId;
  delete clean.createdAt;
  try {
    await updateDoc(doc(db, 'projects', projectId, 'scripts', scriptId), clean);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function replaceNarrationSegments(
  projectId: string,
  segments: Array<Omit<NarrationSegment, 'id' | 'ownerId' | 'projectId' | 'createdAt' | 'updatedAt'>>,
  existingIds: string[]
): Promise<NarrationSegment[]> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Not signed in');
  const path = `projects/${projectId}/segments`;
  const created: NarrationSegment[] = [];
  try {
    const batch = writeBatch(db);
    for (const oldId of existingIds) {
      batch.delete(doc(db, 'projects', projectId, 'segments', oldId));
    }
    for (const seg of segments) {
      const id = makeSafeId('seg');
      const rec: NarrationSegment = {
        ...seg,
        id,
        ownerId: uid,
        projectId,
        text: clampString(seg.text, 5000) || '',
      };
      created.push(rec);
      batch.set(
        doc(db, 'projects', projectId, 'segments', id),
        stripUndefined({
          ...rec,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );
    }
    await batch.commit();
    return created;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function updateNarrationSegmentDoc(
  projectId: string,
  segmentId: string,
  patch: Partial<NarrationSegment>
): Promise<void> {
  const path = `projects/${projectId}/segments/${segmentId}`;
  const clean = stripUndefined({ ...patch, updatedAt: serverTimestamp() });
  delete clean.id;
  delete clean.ownerId;
  delete clean.projectId;
  delete clean.createdAt;
  try {
    await updateDoc(doc(db, 'projects', projectId, 'segments', segmentId), clean);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

function sanitizeBeatFields<T extends Partial<StoryboardBeat>>(b: T): T {
  const out: Record<string, any> = { ...b };
  if (typeof out.narrationText === 'string') out.narrationText = out.narrationText.slice(0, 2000);
  if (typeof out.onScreenText === 'string') out.onScreenText = out.onScreenText.slice(0, 300);
  if (typeof out.triggerWord === 'string') out.triggerWord = out.triggerWord.slice(0, 100);
  if (typeof out.illustrationPrompt === 'string') out.illustrationPrompt = out.illustrationPrompt.slice(0, 1200);
  if (typeof out.dateBadge === 'string') out.dateBadge = out.dateBadge.slice(0, 80);
  if (typeof out.notes === 'string') out.notes = out.notes.slice(0, 600);
  if (typeof out.heroAssetId === 'string') out.heroAssetId = out.heroAssetId.slice(0, 128);
  if (typeof out.heroAssetTitle === 'string') out.heroAssetTitle = out.heroAssetTitle.slice(0, 300);
  if (typeof out.heroAssetUrl === 'string') out.heroAssetUrl = out.heroAssetUrl.slice(0, 1200);
  if (typeof out.heroVideoUrl === 'string') out.heroVideoUrl = out.heroVideoUrl.slice(0, 1200);
  if (typeof out.shotBrief === 'string') out.shotBrief = out.shotBrief.slice(0, 600);
  if (typeof out.assetSearchQuery === 'string') out.assetSearchQuery = out.assetSearchQuery.slice(0, 300);
  if (typeof out.rigPrompt === 'string') out.rigPrompt = out.rigPrompt.slice(0, 600);
  if (Array.isArray(out.calloutItems)) out.calloutItems = out.calloutItems.slice(0, 8);
  if (Array.isArray(out.highlightWords)) out.highlightWords = out.highlightWords.slice(0, 12);
  if (Array.isArray(out.wordTimestamps)) out.wordTimestamps = out.wordTimestamps.slice(0, 160);
  return out as T;
}

export async function replaceStoryboardBeats(
  projectId: string,
  beats: Array<Omit<StoryboardBeat, 'id' | 'ownerId' | 'projectId' | 'createdAt' | 'updatedAt'>>,
  existingIds: string[]
): Promise<StoryboardBeat[]> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Not signed in');
  const path = `projects/${projectId}/beats`;
  const created: StoryboardBeat[] = [];
  try {
    const batch = writeBatch(db);
    for (const oldId of existingIds) {
      batch.delete(doc(db, 'projects', projectId, 'beats', oldId));
    }
    for (const b of beats) {
      const id = makeSafeId('beat');
      const sanitized = sanitizeBeatFields(b);
      const rec: StoryboardBeat = {
        ...sanitized,
        id,
        ownerId: uid,
        projectId,
        narrationText: clampString(sanitized.narrationText, 2000) || '',
        onScreenText: clampString(sanitized.onScreenText, 300),
      };
      created.push(rec);
      batch.set(
        doc(db, 'projects', projectId, 'beats', id),
        stripUndefined({
          ...rec,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );
    }
    await batch.commit();
    return created;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function updateBeatDoc(
  projectId: string,
  beatId: string,
  patch: Partial<StoryboardBeat>
): Promise<void> {
  const path = `projects/${projectId}/beats/${beatId}`;
  const clean = stripUndefined({ ...sanitizeBeatFields(patch), updatedAt: serverTimestamp() });
  delete clean.id;
  delete clean.ownerId;
  delete clean.projectId;
  delete clean.createdAt;
  try {
    await updateDoc(doc(db, 'projects', projectId, 'beats', beatId), clean);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function batchApplyBeatFulfillment(
  projectId: string,
  beatPatches: Array<{ beatId: string; patch: Partial<StoryboardBeat> }>,
  newAssets: Array<Omit<ArchivalAsset, 'id' | 'ownerId' | 'projectId' | 'createdAt' | 'updatedAt'> & { tempId?: string }>,
  deleteOldAssetIds: string[] = []
): Promise<ArchivalAsset[]> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Not signed in');
  const path = `projects/${projectId}/beats`;
  const createdAssets: ArchivalAsset[] = [];
  const tempIdMap = new Map<string, string>();
  try {
    const batch = writeBatch(db);
    for (const oldAssetId of deleteOldAssetIds) {
      batch.delete(doc(db, 'projects', projectId, 'assets', oldAssetId));
    }
    for (const rawAsset of newAssets) {
      const { tempId, ...a } = rawAsset;
      const id = makeSafeId('ast');
      if (tempId) tempIdMap.set(tempId, id);
      const record: ArchivalAsset = {
        ...a,
        id,
        ownerId: uid,
        projectId,
        title: clampString(a.title, 300) || 'Beat Media Asset',
        description: clampString(a.description, 2000),
        sourceUrl: clampString(a.sourceUrl, 1200),
        imageUrl: clampString(a.imageUrl, 1200),
        videoUrl: clampString(a.videoUrl, 1200),
        thumbnailUrl: clampString(a.thumbnailUrl, 1200),
        creator: clampString(a.creator, 300),
        license: clampString(a.license, 200),
        assignedSegmentId: clampString(a.assignedSegmentId, 128),
        assignedBeatId: clampString(a.assignedBeatId, 128),
        limitationNote: clampString(a.limitationNote, 600),
      };
      createdAssets.push(record);
      batch.set(
        doc(db, 'projects', projectId, 'assets', id),
        stripUndefined({
          ...record,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );
    }
    for (const { beatId, patch } of beatPatches) {
      const resolvedPatch: Partial<StoryboardBeat> = { ...patch };
      if (resolvedPatch.heroAssetId && tempIdMap.has(resolvedPatch.heroAssetId)) {
        resolvedPatch.heroAssetId = tempIdMap.get(resolvedPatch.heroAssetId);
      }
      const clean = stripUndefined({
        ...sanitizeBeatFields(resolvedPatch),
        updatedAt: serverTimestamp(),
      });
      delete clean.id;
      delete clean.ownerId;
      delete clean.projectId;
      delete clean.createdAt;
      batch.update(doc(db, 'projects', projectId, 'beats', beatId), clean);
    }
    await batch.commit();
    return createdAssets;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteBeatDoc(projectId: string, beatId: string): Promise<void> {
  const path = `projects/${projectId}/beats/${beatId}`;
  try {
    await deleteDoc(doc(db, 'projects', projectId, 'beats', beatId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function createRenderJobDoc(
  projectId: string,
  job: Omit<RenderJob, 'id' | 'ownerId' | 'projectId' | 'createdAt' | 'updatedAt'>
): Promise<RenderJob> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Not signed in');
  const id = makeSafeId('rnd');
  const path = `projects/${projectId}/renders/${id}`;
  const rec: RenderJob = { ...job, id, ownerId: uid, projectId };
  try {
    await setDoc(
      doc(db, 'projects', projectId, 'renders', id),
      stripUndefined({
        ...rec,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
    return rec;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateRenderJobDoc(
  projectId: string,
  renderId: string,
  patch: Partial<RenderJob>
): Promise<void> {
  const path = `projects/${projectId}/renders/${renderId}`;
  const clean = stripUndefined({ ...patch, updatedAt: serverTimestamp() });
  delete clean.id;
  delete clean.ownerId;
  delete clean.projectId;
  delete clean.createdAt;
  try {
    await updateDoc(doc(db, 'projects', projectId, 'renders', renderId), clean);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}
