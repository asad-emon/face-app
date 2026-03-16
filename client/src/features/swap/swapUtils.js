import { apiBaseUrl } from '../../utils';

export const INPUT_PAGE_SIZE = 12;
export const PAGE_SIZE_OPTIONS = [8, 12, 24, 48, 96];

export function groupByPerson(models) {
  const groups = new Map();
  models.forEach((model) => {
    const personName = (model.person_name || model.name || 'Unknown').trim() || 'Unknown';
    const current = groups.get(personName) || [];
    current.push(model);
    groups.set(personName, current);
  });

  return Array.from(groups.entries())
    .map(([personName, versions]) => ({
      personName,
      versions: versions.sort((a, b) => (b.version || 1) - (a.version || 1)),
    }))
    .sort((a, b) => a.personName.localeCompare(b.personName));
}

export function getDefaultVersionId(versions) {
  if (!versions || versions.length === 0) return '';
  const active = versions.find((item) => item.is_active);
  return String((active || versions[0]).id);
}

export function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function pollGeneratedVideoContent(videoId, token, options = {}) {
  const attempts = Number.isInteger(options.attempts) ? options.attempts : 120;
  const delayMs = Number.isInteger(options.delayMs) ? options.delayMs : 2000;
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const statusResponse = await fetch(`${apiBaseUrl}/videos/generated/${videoId}/status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (statusResponse.ok) {
        const statusPayload = await statusResponse.json();
        const percent = Number(statusPayload?.progress_percent);
        if (onProgress && Number.isFinite(percent)) {
          onProgress(Math.max(0, Math.min(100, percent)));
        }
        if (!statusPayload?.processing && statusPayload?.has_content) {
          const contentResponse = await fetch(`${apiBaseUrl}/videos/generated/${videoId}/content`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (contentResponse.ok) {
            return contentResponse.blob();
          }
        }
      }
    } catch (_err) {
      // noop, fall back to content polling
    }

    const response = await fetch(`${apiBaseUrl}/videos/generated/${videoId}/content`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.status === 409) {
      await wait(delayMs);
      continue;
    }
    if (!response.ok) {
      let detail = 'Failed to load generated video';
      try {
        const data = await response.json();
        detail = data?.detail || detail;
      } catch (_err) {
        // noop
      }
      throw new Error(detail);
    }
    return response.blob();
  }

  throw new Error('Video processing is taking longer than expected. Please try again.');
}

export async function buildVideoFileFromUrl(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch video URL (${response.status})`);
  }
  const blob = await response.blob();
  const contentType = blob.type || 'video/mp4';
  let filename = 'remote-video.mp4';
  try {
    const parsed = new URL(url);
    const lastPart = parsed.pathname.split('/').filter(Boolean).pop();
    if (lastPart) {
      filename = lastPart;
    }
  } catch (_err) {
    // noop
  }
  return new File([blob], filename, { type: contentType });
}
