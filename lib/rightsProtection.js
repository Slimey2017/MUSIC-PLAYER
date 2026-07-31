'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const RIGHTS_BASES = new Set([
  'original_work',
  'exclusive_license',
  'nonexclusive_license',
  'direct_permission',
  'cover_or_remix',
  'public_domain',
  'other',
]);

const REVIEW_STATUSES = new Set([
  'processing',
  'approved',
  'hold',
  'request_information',
  'manual_review',
  'rejected',
]);

class RightsProcessingError extends Error {
  constructor(message, code, httpStatus = 400, publicMessage = message) {
    super(message);
    this.name = 'RightsProcessingError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.publicMessage = publicMessage;
  }
}

function boolFrom(value) {
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function cleanText(value, maxLength) {
  const text = String(value || '').trim();
  return text ? text.slice(0, maxLength) : null;
}

function normalizeRightsDeclaration(input = {}) {
  const basis = cleanText(input.basis || input.rightsBasis, 40);
  if (!RIGHTS_BASES.has(basis)) {
    throw new RightsProcessingError(
      'A valid rights basis is required.',
      'RIGHTS_DECLARATION_REQUIRED',
      400,
      'Choose how you are authorized to upload this recording.'
    );
  }

  const rightsHolder = cleanText(input.rightsHolder, 255);
  if (!rightsHolder) {
    throw new RightsProcessingError(
      'Rights holder is required.',
      'RIGHTS_HOLDER_REQUIRED',
      400,
      'Enter the artist, label, or person who controls the recording rights.'
    );
  }

  const attested = boolFrom(input.attested);
  if (!attested) {
    throw new RightsProcessingError(
      'Rights attestation is required.',
      'RIGHTS_ATTESTATION_REQUIRED',
      400,
      'Confirm that the information is accurate and that you are authorized to upload the recording.'
    );
  }

  let licenseExpiry = cleanText(input.licenseExpiry, 10);
  if (licenseExpiry && !/^\d{4}-\d{2}-\d{2}$/.test(licenseExpiry)) {
    throw new RightsProcessingError('Invalid license expiry date.', 'INVALID_LICENSE_EXPIRY');
  }

  return {
    basis,
    rightsHolder,
    territories: cleanText(input.territories, 255),
    licenseExpiry,
    notes: cleanText(input.notes || input.rightsNotes, 2000),
    attested,
    hasEvidence: boolFrom(input.hasEvidence),
  };
}

function detectAudioContainer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  const ascii = (start, end) => buffer.subarray(start, end).toString('ascii');
  if (ascii(0, 3) === 'ID3' || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)) return 'mp3';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return 'wav';
  if (ascii(0, 4) === 'fLaC') return 'flac';
  if (ascii(0, 4) === 'OggS') return 'ogg';
  if (ascii(0, 4) === 'FORM' && ['AIFF', 'AIFC'].includes(ascii(8, 12))) return 'aiff';
  if (ascii(4, 8) === 'ftyp') return 'mp4';
  if (buffer[0] === 0xff && (buffer[1] === 0xf1 || buffer[1] === 0xf9)) return 'aac';
  if (buffer.subarray(0, 16).equals(Buffer.from('3026b2758e66cf11a6d900aa0062ce6c', 'hex'))) return 'asf';
  if (buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return 'webm';
  return null;
}

function runCommand(command, args, options = {}) {
  const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 30_000);
  return new Promise(resolve => {
    let settled = false;
    let stdout = '';
    let stderr = '';
    let child;
    try {
      child = spawn(command, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        env: options.env || process.env,
      });
    } catch (error) {
      resolve({ ok: false, missing: error.code === 'ENOENT', error, stdout, stderr, code: null });
      return;
    }

    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, ...result });
    };

    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', error => finish({ ok: false, missing: error.code === 'ENOENT', error, code: null }));
    child.on('close', code => finish({ ok: code === 0, missing: false, code }));
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish({ ok: false, missing: false, timedOut: true, code: null });
    }, timeoutMs);
  });
}

async function withTemporaryAudio(buffer, filename, fn) {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'freq-rights-'));
  const safeExtension = (path.extname(filename || '').toLowerCase().match(/^\.[a-z0-9]{1,6}$/) || ['.audio'])[0];
  const filePath = path.join(directory, `upload${safeExtension}`);
  try {
    await fs.promises.writeFile(filePath, buffer, { flag: 'wx', mode: 0o600 });
    return await fn(filePath);
  } finally {
    await fs.promises.rm(directory, { recursive: true, force: true });
  }
}

async function validateAudioFile(filePath, buffer, declaredDuration, env = process.env) {
  const container = detectAudioContainer(buffer);
  if (!container) {
    throw new RightsProcessingError(
      'File signature is not a supported audio container.',
      'INVALID_AUDIO_SIGNATURE',
      415,
      'This file does not appear to be a supported audio recording.'
    );
  }

  const ffprobe = await runCommand(env.FFPROBE_COMMAND || 'ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration,format_name:stream=codec_type,codec_name',
    '-of', 'json',
    filePath,
  ], { timeoutMs: Number(env.RIGHTS_TOOL_TIMEOUT_MS) || 30_000 });

  if (ffprobe.missing) {
    if (boolFrom(env.RIGHTS_REQUIRE_FFPROBE)) {
      throw new RightsProcessingError(
        'ffprobe is required but unavailable.',
        'AUDIO_VALIDATION_UNAVAILABLE',
        503,
        'Audio validation is temporarily unavailable. Please try again later.'
      );
    }
    return {
      status: 'signature_only',
      container,
      duration: Number.isFinite(Number(declaredDuration)) ? Number(declaredDuration) : null,
      formatName: container,
      audioCodec: null,
      warning: 'ffprobe is unavailable; validation used the file signature only.',
    };
  }
  if (!ffprobe.ok) {
    throw new RightsProcessingError(
      `ffprobe rejected the file: ${ffprobe.stderr.slice(0, 300)}`,
      'INVALID_AUDIO_STREAM',
      415,
      'FREQ could not find a playable audio stream in this file.'
    );
  }

  let parsed;
  try { parsed = JSON.parse(ffprobe.stdout); } catch (_) { parsed = {}; }
  const audioStream = (parsed.streams || []).find(stream => stream.codec_type === 'audio');
  const duration = Number(parsed.format?.duration);
  if (!audioStream || !Number.isFinite(duration) || duration <= 0) {
    throw new RightsProcessingError(
      'No valid audio stream or duration was detected.',
      'INVALID_AUDIO_STREAM',
      415,
      'FREQ could not find a playable audio stream in this file.'
    );
  }

  const maxDurationSeconds = Math.max(60, Number(env.RIGHTS_MAX_DURATION_SECONDS) || 21_600);
  if (duration > maxDurationSeconds) {
    throw new RightsProcessingError(
      `Audio duration ${duration}s exceeds configured limit.`,
      'AUDIO_TOO_LONG',
      413,
      'This recording is longer than FREQ currently allows.'
    );
  }

  return {
    status: 'validated',
    container,
    duration,
    formatName: cleanText(parsed.format?.format_name, 120),
    audioCodec: cleanText(audioStream.codec_name, 80),
  };
}

async function scanForMalware(filePath, env = process.env) {
  if (String(env.RIGHTS_SECURITY_SCAN || 'clamav').toLowerCase() === 'disabled') {
    return { status: 'disabled', scanner: null, detail: 'Disabled by configuration.' };
  }
  const scanner = env.CLAMAV_COMMAND || 'clamscan';
  const result = await runCommand(scanner, ['--no-summary', '--infected', filePath], {
    timeoutMs: Number(env.CLAMAV_TIMEOUT_MS) || 60_000,
  });
  if (result.missing) return { status: 'unavailable', scanner, detail: 'Scanner executable was not found.' };
  if (result.timedOut) return { status: 'error', scanner, detail: 'Security scan timed out.' };
  if (result.code === 0) return { status: 'clean', scanner, detail: null };
  if (result.code === 1) {
    return { status: 'infected', scanner, detail: cleanText(result.stdout || result.stderr, 500) };
  }
  return { status: 'error', scanner, detail: cleanText(result.stderr || result.stdout, 500) };
}

async function scanBufferForMalware(buffer, filename, env = process.env) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw new RightsProcessingError('File buffer is required.', 'FILE_REQUIRED');
  }
  return withTemporaryAudio(buffer, filename, filePath => scanForMalware(filePath, env));
}

async function generateChromaprint(filePath, env = process.env) {
  const command = env.FPCALC_COMMAND || 'fpcalc';
  const timeoutMs = Number(env.RIGHTS_TOOL_TIMEOUT_MS) || 30_000;
  const seconds = String(Math.max(30, Math.min(600, Number(env.RIGHTS_FINGERPRINT_SECONDS) || 120)));
  const encodedResult = await runCommand(command, ['-json', '-length', seconds, filePath], { timeoutMs });
  if (encodedResult.missing) {
    return { status: 'unavailable', command, fingerprint: null, raw: null, duration: null, version: null };
  }
  if (!encodedResult.ok) {
    return { status: 'error', command, fingerprint: null, raw: null, duration: null, version: null, detail: cleanText(encodedResult.stderr, 500) };
  }

  let encoded;
  try { encoded = JSON.parse(encodedResult.stdout); } catch (_) { encoded = {}; }
  const rawResult = await runCommand(command, ['-json', '-raw', '-length', seconds, filePath], { timeoutMs });
  let raw = null;
  if (rawResult.ok) {
    try {
      const parsedRaw = JSON.parse(rawResult.stdout);
      raw = Array.isArray(parsedRaw.fingerprint)
        ? parsedRaw.fingerprint.map(Number).filter(Number.isInteger).slice(0, 20_000)
        : null;
    } catch (_) { raw = null; }
  }

  if (!encoded.fingerprint) {
    return { status: 'error', command, fingerprint: null, raw, duration: Number(encoded.duration) || null, version: null };
  }
  return {
    status: 'generated',
    command,
    fingerprint: String(encoded.fingerprint),
    raw,
    duration: Number(encoded.duration) || null,
    version: cleanText(encoded.version, 80),
  };
}

function popcount32(value) {
  let x = value >>> 0;
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

function compareRawFingerprints(left, right, maxOffset = 8) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length < 20 || right.length < 20) return 0;
  let best = 0;
  for (let offset = -maxOffset; offset <= maxOffset; offset += 1) {
    const leftStart = Math.max(0, -offset);
    const rightStart = Math.max(0, offset);
    const length = Math.min(left.length - leftStart, right.length - rightStart);
    if (length < 20) continue;
    let differentBits = 0;
    for (let index = 0; index < length; index += 1) {
      differentBits += popcount32((left[leftStart + index] | 0) ^ (right[rightStart + index] | 0));
    }
    const score = 1 - (differentBits / (length * 32));
    if (score > best) best = score;
  }
  return Number(best.toFixed(4));
}

async function fetchJson(url, options, fetchImpl, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...options, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function lookupAcoustId(fingerprint, duration, env = process.env, fetchImpl = global.fetch) {
  if (!env.ACOUSTID_API_KEY) return { status: 'not_configured', matches: [], best: null };
  if (!fingerprint || !duration || typeof fetchImpl !== 'function') return { status: 'skipped', matches: [], best: null };
  const body = new URLSearchParams({
    client: env.ACOUSTID_API_KEY,
    meta: 'recordings+releasegroups+compress',
    duration: String(Math.round(duration)),
    fingerprint,
  });
  try {
    const payload = await fetchJson('https://api.acoustid.org/v2/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': env.RIGHTS_USER_AGENT || 'FREQ/1.0' },
      body,
    }, fetchImpl, Number(env.RIGHTS_EXTERNAL_TIMEOUT_MS) || 12_000);
    const matches = (payload.results || []).map(result => {
      const recording = result.recordings?.[0] || null;
      return {
        acoustidId: result.id || null,
        score: Number(result.score) || 0,
        recordingId: recording?.id || null,
        title: cleanText(recording?.title, 255),
        artists: (recording?.artists || []).map(artist => cleanText(artist.name, 255)).filter(Boolean).slice(0, 10),
        releaseGroupIds: (recording?.releasegroups || []).map(group => group.id).filter(Boolean).slice(0, 10),
      };
    }).sort((left, right) => right.score - left.score).slice(0, 5);
    return { status: payload.status === 'ok' && matches.length ? 'matched' : 'no_match', matches, best: matches[0] || null };
  } catch (error) {
    return { status: 'error', matches: [], best: null, detail: cleanText(error.message, 300) };
  }
}

let lastMusicBrainzRequestAt = 0;
let musicBrainzQueue = Promise.resolve();
async function lookupMusicBrainz(recordingId, env = process.env, fetchImpl = global.fetch) {
  if (!recordingId || typeof fetchImpl !== 'function') return { status: 'skipped', recording: null };
  const previous = musicBrainzQueue;
  let releaseQueue;
  musicBrainzQueue = new Promise(resolve => { releaseQueue = resolve; });
  await previous;
  try {
    const waitMs = Math.max(0, 1050 - (Date.now() - lastMusicBrainzRequestAt));
    if (waitMs) await new Promise(resolve => setTimeout(resolve, waitMs));
    lastMusicBrainzRequestAt = Date.now();
    const userAgent = env.MUSICBRAINZ_USER_AGENT || env.RIGHTS_USER_AGENT || 'FREQ/1.0 (contact: admin@example.invalid)';
    try {
      const payload = await fetchJson(
        `https://musicbrainz.org/ws/2/recording/${encodeURIComponent(recordingId)}?inc=artists+releases+isrcs&fmt=json`,
        { headers: { Accept: 'application/json', 'User-Agent': userAgent } },
        fetchImpl,
        Number(env.RIGHTS_EXTERNAL_TIMEOUT_MS) || 12_000
      );
      return {
        status: 'found',
        recording: {
          id: payload.id || recordingId,
          title: cleanText(payload.title, 255),
          artists: (payload['artist-credit'] || []).map(credit => cleanText(credit.name || credit.artist?.name, 255)).filter(Boolean).slice(0, 10),
          isrcs: (payload.isrcs || []).map(value => cleanText(value, 32)).filter(Boolean).slice(0, 20),
          releases: (payload.releases || []).map(release => ({ id: release.id, title: cleanText(release.title, 255) })).slice(0, 20),
        },
      };
    } catch (error) {
      return { status: 'error', recording: null, detail: cleanText(error.message, 300) };
    }
  } finally {
    releaseQueue();
  }
}

function chooseInternalMatch(candidates, sha256, rawFingerprint, owner) {
  const rows = Array.isArray(candidates) ? candidates : [];
  const exact = rows.find(row => row.sha256 === sha256);
  if (exact) {
    return {
      type: 'exact_hash',
      score: 1,
      cloudFileId: exact.cloud_file_id,
      sameOwner: exact.owner === owner,
      owner: exact.owner,
    };
  }

  let best = null;
  for (const row of rows) {
    const score = compareRawFingerprints(rawFingerprint, row.fingerprint_raw);
    if (!best || score > best.score) {
      best = { type: 'chromaprint_similarity', score, cloudFileId: row.cloud_file_id, sameOwner: row.owner === owner, owner: row.owner };
    }
  }
  return best && best.score >= 0.86 ? best : null;
}

function decideRights({ declaration, security, fingerprint, acoustid, internalMatch, evidenceCount = 0, env = process.env }) {
  const signals = [];
  let riskScore = 0;
  const hasEvidence = declaration.hasEvidence || evidenceCount > 0;

  if (security.status === 'infected') {
    return {
      status: 'rejected',
      code: 'security_threat',
      riskScore: 100,
      message: 'This upload was blocked by the security scanner. No copyright conclusion was made.',
      signals: [{ type: 'security_scan', severity: 'critical', result: 'infected' }],
    };
  }

  if (['unavailable', 'error', 'disabled'].includes(security.status)) {
    signals.push({ type: 'security_scan', severity: 'warning', result: security.status });
    riskScore += 10;
    if (boolFrom(env.RIGHTS_REQUIRE_CLAMAV)) {
      return {
        status: 'hold', code: 'security_scan_unavailable', riskScore,
        message: 'This upload is safely on hold until the required security scan can run.', signals,
      };
    }
  }

  if (fingerprint.status !== 'generated' && boolFrom(env.RIGHTS_REQUIRE_CHROMAPRINT)) {
    signals.push({ type: 'fingerprint', severity: 'warning', result: fingerprint.status });
    riskScore += 10;
    return {
      status: 'hold', code: 'fingerprint_unavailable', riskScore,
      message: 'This upload is safely on hold until the required recording fingerprint can be generated.', signals,
    };
  }

  if (internalMatch) {
    const severity = internalMatch.sameOwner ? 'notice' : 'high';
    signals.push({
      type: 'internal_recording_match', severity, matchType: internalMatch.type,
      score: internalMatch.score, matchedCloudFileId: internalMatch.cloudFileId,
      sameUploader: internalMatch.sameOwner,
    });
    riskScore += internalMatch.sameOwner ? 15 : (internalMatch.type === 'exact_hash' ? 65 : 50);
    if (!internalMatch.sameOwner) {
      return {
        status: internalMatch.type === 'exact_hash' ? 'hold' : 'manual_review',
        code: internalMatch.type === 'exact_hash' ? 'exact_internal_match' : 'similar_internal_recording',
        riskScore: Math.min(100, riskScore),
        message: 'A recording already in FREQ appears to match this upload. This is an identification signal, not an infringement finding. A reviewer will verify the rights information.',
        signals,
      };
    }
  }

  const externalScore = Number(acoustid.best?.score) || 0;
  if (externalScore >= 0.75) {
    signals.push({
      type: 'external_recording_match', severity: externalScore >= 0.9 ? 'high' : 'notice',
      score: externalScore, recordingId: acoustid.best.recordingId,
      title: acoustid.best.title, artists: acoustid.best.artists,
      disclaimer: 'Identification metadata does not prove copyright ownership.',
    });
    riskScore += externalScore >= 0.9 ? 35 : 20;
  }

  if (internalMatch?.sameOwner) {
    return {
      status: 'request_information', code: 'duplicate_from_same_uploader', riskScore,
      message: 'This exact or very similar recording is already in your FREQ library. Confirm whether this is a new master, edition, or authorized re-release.', signals,
    };
  }

  const licensedBasis = ['exclusive_license', 'nonexclusive_license', 'direct_permission'].includes(declaration.basis);
  if ((licensedBasis || declaration.basis === 'cover_or_remix') && !hasEvidence) {
    return {
      status: 'request_information', code: 'license_evidence_needed', riskScore: Math.max(riskScore, 30),
      message: 'Add a license, permission, or other supporting document. FREQ will review it without treating a database match as proof of infringement.', signals,
    };
  }

  if (declaration.basis === 'public_domain' && !declaration.notes && !hasEvidence) {
    return {
      status: 'request_information', code: 'public_domain_source_needed', riskScore: Math.max(riskScore, 25),
      message: 'Add the source or explanation supporting the public-domain status of this specific recording.', signals,
    };
  }

  if (externalScore >= 0.75) {
    return {
      status: hasEvidence || declaration.basis === 'original_work' ? 'manual_review' : 'request_information',
      code: 'external_identification_signal', riskScore,
      message: 'A reference recording match was found. This does not prove ownership or infringement; FREQ will verify the declaration before publishing.', signals,
    };
  }

  if (licensedBasis || declaration.basis === 'cover_or_remix' || declaration.basis === 'public_domain') {
    return {
      status: 'manual_review', code: 'supporting_rights_review', riskScore: Math.max(riskScore, 20),
      message: 'Your supporting rights information is ready for a human review.', signals,
    };
  }

  if (declaration.basis === 'other') {
    return {
      status: 'request_information', code: 'rights_basis_details_needed', riskScore: Math.max(riskScore, 20),
      message: 'Add more detail about how you are authorized to use this recording.', signals,
    };
  }

  if (fingerprint.status !== 'generated') {
    signals.push({ type: 'fingerprint', severity: 'warning', result: fingerprint.status });
  }

  return {
    status: 'approved', code: fingerprint.status === 'generated' ? 'no_conflicting_signals' : 'approved_limited_identification',
    riskScore: Math.min(100, riskScore),
    message: fingerprint.status === 'generated'
      ? 'No conflicting recording signals were found. Your rights declaration is recorded.'
      : 'Your rights declaration is recorded. Identification was limited because the fingerprint tool was unavailable.',
    signals,
  };
}

async function analyzeAudioUpload(options) {
  const {
    buffer,
    filename,
    mimeType,
    declaredDuration,
    declaration: declarationInput,
    owner,
    findInternalCandidates = async () => [],
    env = process.env,
    fetchImpl = global.fetch,
    evidenceCount = 0,
  } = options || {};

  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw new RightsProcessingError('Audio buffer is required.', 'AUDIO_REQUIRED', 400, 'No audio file was received.');
  }
  const declaration = normalizeRightsDeclaration({ ...declarationInput, hasEvidence: evidenceCount > 0 || declarationInput?.hasEvidence });

  return withTemporaryAudio(buffer, filename, async filePath => {
    const validation = await validateAudioFile(filePath, buffer, declaredDuration, env);
    const security = await scanForMalware(filePath, env);
    if (security.status === 'infected') {
      throw new RightsProcessingError(
        'Security scanner detected a threat.',
        'SECURITY_THREAT_DETECTED',
        422,
        'This file was blocked by the security scanner. No copyright conclusion was made.'
      );
    }

    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    const fingerprint = await generateChromaprint(filePath, env);
    const duration = validation.duration || fingerprint.duration || Number(declaredDuration) || null;
    const acoustid = await lookupAcoustId(fingerprint.fingerprint, fingerprint.duration || duration, env, fetchImpl);
    const musicbrainz = await lookupMusicBrainz(acoustid.best?.recordingId, env, fetchImpl);
    const candidates = await findInternalCandidates({ sha256, duration, fingerprintRaw: fingerprint.raw });
    const internalMatch = chooseInternalMatch(candidates, sha256, fingerprint.raw, owner);
    const decision = decideRights({ declaration, security, fingerprint, acoustid, internalMatch, evidenceCount, env });

    return {
      sha256,
      filename: cleanText(filename, 255),
      mimeType: cleanText(mimeType, 255),
      declaration,
      validation,
      security,
      fingerprint,
      acoustid,
      musicbrainz,
      internalMatch,
      decision,
      providerVersions: {
        pipeline: 'freq-rights-v1',
        chromaprint: fingerprint.version || null,
        identificationProvider: 'acoustid',
        metadataProvider: 'musicbrainz',
      },
      analyzedAt: new Date().toISOString(),
    };
  });
}

module.exports = {
  RIGHTS_BASES,
  REVIEW_STATUSES,
  RightsProcessingError,
  analyzeAudioUpload,
  chooseInternalMatch,
  compareRawFingerprints,
  decideRights,
  detectAudioContainer,
  normalizeRightsDeclaration,
  scanBufferForMalware,
};
