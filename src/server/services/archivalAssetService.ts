import type { ArchivalAsset } from '../../types/cineforge.ts';
import type { IAssetManagementService } from './interfaces.ts';

type DraftAsset = Omit<ArchivalAsset, 'id' | 'ownerId' | 'projectId' | 'createdAt' | 'updatedAt'>;

const ALLOWED_IMAGE_HOSTS = new Set([
  'upload.wikimedia.org',
  'commons.wikimedia.org',
  'tile.loc.gov',
  'www.loc.gov',
  'cdn.loc.gov',
  'loc.gov',
  'images-assets.nasa.gov',
  'images-api.nasa.gov',
]);

export function isAllowedArchivalUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    if (ALLOWED_IMAGE_HOSTS.has(host)) return true;
    // Allow subdomains of wikimedia.org, loc.gov, nasa.gov
    if (
      host.endsWith('.wikimedia.org') ||
      host.endsWith('.loc.gov') ||
      host.endsWith('.nasa.gov')
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function stripHtmlTags(input: string | undefined): string {
  if (!input) return '';
  return input
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function safeJsonResponse(resp: Response): Promise<any | null> {
  const ct = resp.headers.get('content-type') || '';
  const text = await resp.text();
  const trimmed = text.trimStart();
  if (ct.includes('text/html') || trimmed.startsWith('<') || !trimmed) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function searchWikimediaCommons(
  query: string,
  category: ArchivalAsset['category'],
  limit = 4
): Promise<DraftAsset[]> {
  try {
    const url = new URL('https://commons.wikimedia.org/w/api.php');
    url.searchParams.set('action', 'query');
    url.searchParams.set('generator', 'search');
    url.searchParams.set('gsrnamespace', '6');
    url.searchParams.set('gsrsearch', `${query} filetype:bitmap`);
    url.searchParams.set('gsrlimit', String(limit));
    url.searchParams.set('prop', 'imageinfo');
    url.searchParams.set('iiprop', 'url|extmetadata|mime|size');
    url.searchParams.set('iiurlwidth', '1280');
    url.searchParams.set('format', 'json');
    url.searchParams.set('origin', '*');

    const resp = await fetch(url.toString(), {
      headers: {
        'User-Agent': 'CineForgeDocumentaryStudio/1.0 (https://cineforge.studio)',
      },
      signal: AbortSignal.timeout(9000),
    });
    if (!resp.ok) return [];
    const data = await safeJsonResponse(resp);
    if (!data) return [];
    const pages = data?.query?.pages ? Object.values(data.query.pages) : [];
    const results: DraftAsset[] = [];

    for (const page of pages as any[]) {
      const info = page?.imageinfo?.[0];
      if (!info) continue;
      const mime: string = info.mime || '';
      if (!mime.startsWith('image/') || mime.includes('svg')) continue;
      const width = Number(info.width || 0);
      const height = Number(info.height || 0);
      if (width > 0 && width < 400 && height < 400) continue;

      const meta = info.extmetadata || {};
      const title =
        stripHtmlTags(meta.ObjectName?.value) ||
        String(page.title || '')
          .replace(/^File:/i, '')
          .replace(/\.[a-z0-9]+$/i, '')
          .replace(/_/g, ' ');
      const description = stripHtmlTags(meta.ImageDescription?.value).slice(0, 600);
      const creator = stripHtmlTags(meta.Artist?.value || meta.Credit?.value) || 'Wikimedia Commons Contributor';
      const license =
        stripHtmlTags(meta.LicenseShortName?.value || meta.UsageTerms?.value) || 'Wikimedia Commons / Public Archive';
      const imageUrl = info.thumburl || info.url;
      const sourceUrl = info.descriptionurl || `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title || '')}`;

      if (!imageUrl || !isAllowedArchivalUrl(imageUrl)) continue;

      results.push({
        title: title.slice(0, 280) || query,
        description: description || `Archival image found via Wikimedia Commons for "${query}".`,
        sourceProvider: 'wikimedia',
        sourceUrl,
        imageUrl,
        thumbnailUrl: imageUrl,
        creator: creator.slice(0, 260),
        license: license.slice(0, 180),
        category,
        approvalStatus: 'pending',
        downloadStatus: 'ready',
      });
    }
    return results;
  } catch (err) {
    console.warn('Wikimedia search warning:', err);
    return [];
  }
}

async function searchLibraryOfCongress(
  query: string,
  category: ArchivalAsset['category'],
  limit = 3
): Promise<DraftAsset[]> {
  try {
    const endpoint =
      category === 'map'
        ? 'https://www.loc.gov/maps/'
        : category === 'newspaper'
        ? 'https://www.loc.gov/newspapers/'
        : 'https://www.loc.gov/photos/';
    const url = new URL(endpoint);
    url.searchParams.set('q', query);
    url.searchParams.set('fo', 'json');
    url.searchParams.set('c', String(limit));

    const resp = await fetch(url.toString(), {
      headers: {
        'User-Agent': 'CineForgeDocumentaryStudio/1.0',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(9000),
    });
    if (!resp.ok) return [];
    const data = await safeJsonResponse(resp);
    if (!data) return [];
    const items = Array.isArray(data?.results) ? data.results : [];
    const results: DraftAsset[] = [];

    for (const item of items) {
      const imageList: string[] = Array.isArray(item.image_url) ? item.image_url : [];
      const picked =
        imageList.find((u) => typeof u === 'string' && u.startsWith('https://') && !u.endsWith('.gif')) ||
        imageList.find((u) => typeof u === 'string' && u.startsWith('http'));
      if (!picked) continue;
      const httpsUrl = picked.replace(/^http:\/\//i, 'https://');
      if (!isAllowedArchivalUrl(httpsUrl)) continue;

      const title = String(item.title || query).slice(0, 280);
      const creator =
        (Array.isArray(item.contributor) ? item.contributor.join(', ') : item.contributor) ||
        'Library of Congress Prints & Photographs Division';
      const desc =
        (Array.isArray(item.description) ? item.description.join(' ') : item.description) ||
        `Historical item archived by the Library of Congress (${item.date || 'Archival record'}).`;
      const sourceUrl = String(item.url || item.id || 'https://www.loc.gov/');

      results.push({
        title,
        description: String(desc).slice(0, 600),
        sourceProvider: 'loc',
        sourceUrl: sourceUrl.startsWith('http') ? sourceUrl : `https://www.loc.gov${sourceUrl}`,
        imageUrl: httpsUrl,
        thumbnailUrl: httpsUrl,
        creator: String(creator).slice(0, 260),
        license: 'Library of Congress (No Known Restrictions / Archival)',
        category,
        approvalStatus: 'pending',
        downloadStatus: 'ready',
      });
    }
    return results;
  } catch (err) {
    console.warn('Library of Congress search warning:', err);
    return [];
  }
}

async function searchNasaArchive(
  query: string,
  category: ArchivalAsset['category'],
  limit = 3
): Promise<DraftAsset[]> {
  try {
    const url = new URL('https://images-api.nasa.gov/search');
    url.searchParams.set('q', query);
    url.searchParams.set('media_type', 'image');
    url.searchParams.set('page_size', String(limit));

    const resp = await fetch(url.toString(), {
      headers: { 'User-Agent': 'CineForgeDocumentaryStudio/1.0' },
      signal: AbortSignal.timeout(9000),
    });
    if (!resp.ok) return [];
    const data = await safeJsonResponse(resp);
    if (!data) return [];
    const items = Array.isArray(data?.collection?.items) ? data.collection.items : [];
    const results: DraftAsset[] = [];

    for (const item of items) {
      const meta = item?.data?.[0];
      const link = item?.links?.find((l: any) => l.render === 'image' || l.rel === 'preview');
      if (!meta || !link?.href) continue;
      const imageUrl = String(link.href).replace(/^http:\/\//i, 'https://');
      if (!isAllowedArchivalUrl(imageUrl)) continue;

      const nasaId = meta.nasa_id || '';
      results.push({
        title: String(meta.title || query).slice(0, 280),
        description: String(meta.description || 'Official NASA archival photograph.').slice(0, 600),
        sourceProvider: 'nasa',
        sourceUrl: nasaId ? `https://images.nasa.gov/details/${encodeURIComponent(nasaId)}` : 'https://images.nasa.gov/',
        imageUrl,
        thumbnailUrl: imageUrl,
        creator: String(meta.photographer || meta.center || 'NASA Archive').slice(0, 260),
        license: 'NASA Public Domain (US Government Work)',
        category,
        approvalStatus: 'pending',
        downloadStatus: 'ready',
      });
    }
    return results;
  } catch (err) {
    console.warn('NASA archive search warning:', err);
    return [];
  }
}

export async function searchWikimediaVideos(
  query: string,
  limit = 4
): Promise<DraftAsset[]> {
  try {
    const url = new URL('https://commons.wikimedia.org/w/api.php');
    url.searchParams.set('action', 'query');
    url.searchParams.set('generator', 'search');
    url.searchParams.set('gsrnamespace', '6');
    url.searchParams.set('gsrsearch', `${query} filetype:video`);
    url.searchParams.set('gsrlimit', String(limit));
    url.searchParams.set('prop', 'imageinfo');
    url.searchParams.set('iiprop', 'url|extmetadata|mime|size|duration');
    url.searchParams.set('iiurlwidth', '960');
    url.searchParams.set('format', 'json');
    url.searchParams.set('origin', '*');

    const resp = await fetch(url.toString(), {
      headers: {
        'User-Agent': 'CineForgeDocumentaryStudio/1.0 (https://cineforge.studio)',
      },
      signal: AbortSignal.timeout(9000),
    });
    if (!resp.ok) return [];
    const data = await safeJsonResponse(resp);
    if (!data) return [];
    const pages = data?.query?.pages ? Object.values(data.query.pages) : [];
    const results: DraftAsset[] = [];

    for (const page of pages as any[]) {
      const info = page?.imageinfo?.[0];
      if (!info) continue;
      const mime: string = String(info.mime || '').toLowerCase();
      const videoUrl: string = String(info.url || '');
      const isPlayableMime =
        mime.includes('webm') ||
        mime.includes('mp4') ||
        mime.includes('ogg') ||
        /\.(webm|mp4|ogv)(\?|$)/i.test(videoUrl);
      if (!isPlayableMime) continue;
      if (!videoUrl || !isAllowedArchivalUrl(videoUrl)) continue;
      // Skip oversized multi-hundred-MB cinema files so browser streaming stays snappy
      const sizeBytes = Number(info.size || 0);
      if (sizeBytes > 65 * 1024 * 1024) continue;

      const meta = info.extmetadata || {};
      const title =
        stripHtmlTags(meta.ObjectName?.value) ||
        String(page.title || '')
          .replace(/^File:/i, '')
          .replace(/\.[a-z0-9]+$/i, '')
          .replace(/_/g, ' ');
      const description = stripHtmlTags(meta.ImageDescription?.value).slice(0, 600);
      const creator = stripHtmlTags(meta.Artist?.value || meta.Credit?.value) || 'Wikimedia Commons Archival Film';
      const license =
        stripHtmlTags(meta.LicenseShortName?.value || meta.UsageTerms?.value) || 'Wikimedia Commons / Public Domain Video';
      const thumbUrl = info.thumburl && isAllowedArchivalUrl(info.thumburl) ? String(info.thumburl) : '';
      const sourceUrl = info.descriptionurl || `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title || '')}`;
      const durationSec = Number(info.duration || 0) > 0 ? Math.round(Number(info.duration) * 10) / 10 : undefined;

      results.push({
        title: title.slice(0, 280) || `${query} (Archival Clip)`,
        description: description || `Public-domain archival video clip from Wikimedia Commons for "${query}".`,
        sourceProvider: 'wikimedia_video',
        sourceUrl,
        imageUrl: thumbUrl,
        videoUrl,
        thumbnailUrl: thumbUrl,
        mediaKind: 'video',
        durationSec,
        creator: creator.slice(0, 260),
        license: license.slice(0, 180),
        category: 'video_clip',
        approvalStatus: 'pending',
        downloadStatus: 'ready',
      });
    }
    return results;
  } catch (err) {
    console.warn('Wikimedia video search warning:', err);
    return [];
  }
}

export async function searchNasaVideos(
  query: string,
  limit = 3
): Promise<DraftAsset[]> {
  try {
    const url = new URL('https://images-api.nasa.gov/search');
    url.searchParams.set('q', query);
    url.searchParams.set('media_type', 'video');
    url.searchParams.set('page_size', String(limit));

    const resp = await fetch(url.toString(), {
      headers: { 'User-Agent': 'CineForgeDocumentaryStudio/1.0' },
      signal: AbortSignal.timeout(9000),
    });
    if (!resp.ok) return [];
    const data = await safeJsonResponse(resp);
    if (!data) return [];
    const items = Array.isArray(data?.collection?.items) ? data.collection.items.slice(0, limit) : [];

    const resolved = await Promise.all(
      items.map(async (item: any): Promise<DraftAsset | null> => {
        try {
          const meta = item?.data?.[0];
          const collectionUrl = String(item?.href || '').replace(/^http:\/\//i, 'https://');
          if (!meta || !collectionUrl || !isAllowedArchivalUrl(collectionUrl)) return null;

          const previewLink = item?.links?.find((l: any) => l.render === 'image' || l.rel === 'preview');
          const thumbCandidate = previewLink?.href ? String(previewLink.href).replace(/^http:\/\//i, 'https://') : '';
          const thumbUrl = thumbCandidate && isAllowedArchivalUrl(thumbCandidate) ? thumbCandidate : '';

          const colResp = await fetch(collectionUrl, {
            headers: { 'User-Agent': 'CineForgeDocumentaryStudio/1.0' },
            signal: AbortSignal.timeout(6000),
          });
          if (!colResp.ok) return null;
          const files = await safeJsonResponse(colResp);
          if (!Array.isArray(files)) return null;

          const mp4Candidates = files
            .filter((u: any) => typeof u === 'string' && /\.mp4(\?|$)/i.test(u))
            .map((u: string) => u.replace(/^http:\/\//i, 'https://'))
            .filter((u: string) => isAllowedArchivalUrl(u));

          const chosenMp4 =
            mp4Candidates.find((u: string) => /~small\.mp4$/i.test(u)) ||
            mp4Candidates.find((u: string) => /~medium\.mp4$/i.test(u)) ||
            mp4Candidates.find((u: string) => /~mobile\.mp4$/i.test(u)) ||
            mp4Candidates[0];
          if (!chosenMp4) return null;

          const nasaId = meta.nasa_id || '';
          return {
            title: String(meta.title || query).slice(0, 280),
            description: String(meta.description || 'Official NASA public-domain video clip.').slice(0, 600),
            sourceProvider: 'nasa_video',
            sourceUrl: nasaId
              ? `https://images.nasa.gov/details/${encodeURIComponent(nasaId)}`
              : 'https://images.nasa.gov/',
            imageUrl: thumbUrl,
            videoUrl: chosenMp4,
            thumbnailUrl: thumbUrl,
            mediaKind: 'video',
            creator: String(meta.photographer || meta.center || 'NASA Public Archive').slice(0, 260),
            license: 'NASA Public Domain (US Government Work)',
            category: 'video_clip',
            approvalStatus: 'pending',
            downloadStatus: 'ready',
          };
        } catch {
          return null;
        }
      })
    );

    return resolved.filter((r): r is DraftAsset => Boolean(r));
  } catch (err) {
    console.warn('NASA video search warning:', err);
    return [];
  }
}

function normalizeTitleKey(title: string | undefined): string {
  return String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export class ArchivalAssetService implements IAssetManagementService {
  async discoverArchivalAssets(params: {
    queries: Array<{ query: string; category: ArchivalAsset['category']; subject: string }>;
    topic: string;
  }): Promise<DraftAsset[]> {
    const seenUrls = new Set<string>();
    const collected: DraftAsset[] = [];
    const queries = params.queries.length > 0
      ? params.queries.slice(0, 6)
      : [{ query: params.topic, category: 'photograph' as const, subject: params.topic }];

    const batchResults = await Promise.all(
      queries.map(async (q) => {
        const [wiki, loc, nasa] = await Promise.all([
          searchWikimediaCommons(q.query, q.category, 3),
          searchLibraryOfCongress(q.query, q.category, 2),
          searchNasaArchive(q.query, q.category, 2),
        ]);
        const merged = [...wiki, ...loc, ...nasa].map((item) => ({
          ...item,
          mediaKind: item.mediaKind || ('image' as const),
        }));
        if (merged.length === 0) {
          return [
            {
              title: `Archival gap: ${q.subject}`,
              description: `No verified public-domain photograph was returned from Wikimedia Commons, Library of Congress, or NASA for "${q.query}".`,
              sourceProvider: 'wikimedia' as const,
              sourceUrl: '',
              imageUrl: '',
              thumbnailUrl: '',
              mediaKind: 'image' as const,
              creator: 'Unverified — manual archival upload recommended',
              license: 'None',
              category: q.category,
              approvalStatus: 'pending' as const,
              downloadStatus: 'unavailable' as const,
              limitationNote: `Authentic archival image not located automatically for "${q.subject}". Upload an authorized source photo or refine the archive search query.`,
            },
          ];
        }
        return merged;
      })
    );

    for (const list of batchResults) {
      for (const item of list) {
        const key = item.imageUrl || item.title;
        if (seenUrls.has(key)) continue;
        seenUrls.add(key);
        collected.push(item);
      }
    }

    return collected.slice(0, 18);
  }

  async searchArchive(
    query: string,
    providers: Array<'wikimedia' | 'loc' | 'nasa'> = ['wikimedia', 'loc', 'nasa'],
    mediaKind: 'image' | 'video' | 'all' = 'image'
  ): Promise<DraftAsset[]> {
    const tasks: Promise<DraftAsset[]>[] = [];
    if (mediaKind === 'image' || mediaKind === 'all') {
      if (providers.includes('wikimedia')) tasks.push(searchWikimediaCommons(query, 'photograph', 6));
      if (providers.includes('loc')) tasks.push(searchLibraryOfCongress(query, 'archive', 5));
      if (providers.includes('nasa')) tasks.push(searchNasaArchive(query, 'photograph', 4));
    }
    if (mediaKind === 'video' || mediaKind === 'all') {
      if (providers.includes('wikimedia')) tasks.push(searchWikimediaVideos(query, 5));
      if (providers.includes('nasa')) tasks.push(searchNasaVideos(query, 3));
    }

    const results = (await Promise.all(tasks)).flat();
    const dedup = new Map<string, DraftAsset>();
    for (const r of results) {
      const key = r.videoUrl || r.imageUrl;
      if (key && !dedup.has(key)) {
        dedup.set(key, {
          ...r,
          mediaKind: r.mediaKind || (r.videoUrl ? 'video' : 'image'),
        });
      }
    }
    return Array.from(dedup.values());
  }

  /**
   * Zero-repeat beat-specific media lookup across Wikimedia Commons, Library of Congress, and NASA.
   * Strictly skips any URL or normalized title already claimed in excludeUrls / excludeTitles.
   */
  async searchUniqueBeatMedia(params: {
    query: string;
    fallbackQuery?: string;
    mediaKind: 'image' | 'video';
    excludeUrls: Set<string>;
    excludeTitles: Set<string>;
  }): Promise<DraftAsset | null> {
    const queriesToTry = [params.query.trim()];
    if (params.fallbackQuery && params.fallbackQuery.trim() && params.fallbackQuery.trim().toLowerCase() !== params.query.trim().toLowerCase()) {
      queriesToTry.push(params.fallbackQuery.trim());
    }

    for (const q of queriesToTry) {
      if (!q) continue;
      let candidates: DraftAsset[] = [];
      if (params.mediaKind === 'video') {
        const [wikiVid, nasaVid] = await Promise.all([
          searchWikimediaVideos(q, 6),
          searchNasaVideos(q, 3),
        ]);
        candidates = [...wikiVid, ...nasaVid];
      } else {
        const [wikiImg, locImg, nasaImg] = await Promise.all([
          searchWikimediaCommons(q, 'photograph', 6),
          searchLibraryOfCongress(q, 'photograph', 4),
          searchNasaArchive(q, 'photograph', 3),
        ]);
        candidates = [...wikiImg, ...locImg, ...nasaImg].map((item) => ({
          ...item,
          mediaKind: 'image' as const,
        }));
      }

      for (const item of candidates) {
        const primaryUrl = params.mediaKind === 'video' ? item.videoUrl : item.imageUrl;
        if (!primaryUrl) continue;
        const normTitle = normalizeTitleKey(item.title);
        if (params.excludeUrls.has(primaryUrl)) continue;
        if (item.imageUrl && params.excludeUrls.has(item.imageUrl)) continue;
        if (normTitle && params.excludeTitles.has(normTitle)) continue;
        return item;
      }
    }
    return null;
  }
}
