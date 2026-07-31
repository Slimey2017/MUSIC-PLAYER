'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  RightsProcessingError,
  analyzeAudioUpload,
  compareRawFingerprints,
  decideRights,
  detectAudioContainer,
  normalizeRightsDeclaration,
} = require('../lib/rightsProtection');

function makeSilentWav(seconds = 1, sampleRate = 8000) {
  const sampleCount = seconds * sampleRate;
  const dataSize = sampleCount * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}

const originalDeclaration = {
  basis: 'original_work',
  rightsHolder: 'Test Artist',
  attested: true,
};

test('detectAudioContainer validates real signatures instead of trusting MIME', () => {
  assert.equal(detectAudioContainer(makeSilentWav()), 'wav');
  assert.equal(detectAudioContainer(Buffer.from('not audio at all')), null);
});

test('normalizeRightsDeclaration requires a basis, holder, and attestation', () => {
  assert.deepEqual(normalizeRightsDeclaration(originalDeclaration), {
    basis: 'original_work', rightsHolder: 'Test Artist', territories: null,
    licenseExpiry: null, notes: null, attested: true, hasEvidence: false,
  });
  assert.throws(
    () => normalizeRightsDeclaration({ basis: 'original_work', rightsHolder: 'Test Artist' }),
    error => error instanceof RightsProcessingError && error.code === 'RIGHTS_ATTESTATION_REQUIRED'
  );
});

test('Chromaprint raw comparison is exact for equal fingerprints', () => {
  const fingerprint = Array.from({ length: 64 }, (_, index) => (index * 2654435761) | 0);
  assert.equal(compareRawFingerprints(fingerprint, fingerprint), 1);
  assert.ok(compareRawFingerprints(fingerprint, fingerprint.slice(2)) > 0.99);
});

test('an internal match from another uploader is held without an accusation', () => {
  const result = decideRights({
    declaration: originalDeclaration,
    security: { status: 'clean' },
    fingerprint: { status: 'generated' },
    acoustid: { best: null },
    internalMatch: { type: 'exact_hash', score: 1, cloudFileId: 9, sameOwner: false },
    env: {},
  });
  assert.equal(result.status, 'hold');
  assert.match(result.message, /not an infringement finding/i);
});

test('an AcoustID match routes to review and remains identification-only', () => {
  const result = decideRights({
    declaration: originalDeclaration,
    security: { status: 'clean' },
    fingerprint: { status: 'generated' },
    acoustid: { best: { score: 0.97, recordingId: 'mbid', title: 'Known Song', artists: ['Known Artist'] } },
    internalMatch: null,
    env: {},
  });
  assert.equal(result.status, 'manual_review');
  assert.match(result.message, /does not prove ownership or infringement/i);
});

test('licensed uploads request evidence instead of being auto-rejected', () => {
  const result = decideRights({
    declaration: { ...originalDeclaration, basis: 'nonexclusive_license', hasEvidence: false },
    security: { status: 'clean' }, fingerprint: { status: 'generated' },
    acoustid: { best: null }, internalMatch: null, env: {},
  });
  assert.equal(result.status, 'request_information');
  assert.equal(result.code, 'license_evidence_needed');
});

test('an original upload with no conflicting signals can be approved', () => {
  const result = decideRights({
    declaration: originalDeclaration,
    security: { status: 'clean' }, fingerprint: { status: 'generated' },
    acoustid: { best: null }, internalMatch: null, env: {},
  });
  assert.equal(result.status, 'approved');
});

test('a required but unavailable fingerprint tool places the upload on hold', () => {
  const result = decideRights({
    declaration: originalDeclaration,
    security: { status: 'clean' }, fingerprint: { status: 'unavailable' },
    acoustid: { best: null }, internalMatch: null,
    env: { RIGHTS_REQUIRE_CHROMAPRINT: 'true' },
  });
  assert.equal(result.status, 'hold');
  assert.equal(result.code, 'fingerprint_unavailable');
});

test('the complete pipeline validates, hashes, and decides a WAV upload', async () => {
  const wav = makeSilentWav();
  const result = await analyzeAudioUpload({
    buffer: wav,
    filename: 'original.wav',
    mimeType: 'audio/wav',
    declaration: originalDeclaration,
    owner: 'tester',
    findInternalCandidates: async () => [],
    env: {
      ...process.env,
      RIGHTS_SECURITY_SCAN: 'disabled',
      RIGHTS_REQUIRE_CLAMAV: 'false',
      FPCALC_COMMAND: 'missing-fpcalc-for-test',
      RIGHTS_TOOL_TIMEOUT_MS: '5000',
    },
  });
  assert.equal(result.validation.container, 'wav');
  assert.match(result.sha256, /^[0-9a-f]{64}$/);
  assert.equal(result.fingerprint.status, 'unavailable');
  assert.equal(result.decision.status, 'approved');
});
