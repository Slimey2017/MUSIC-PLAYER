// ─── Artist Verification — claim wizard (Artist Dashboard > Verification) ──────
// Renders into #verificationSectionBody. State machine mirrors the backend's
// artist_verification_requests.status enum exactly — see lib/verificationCore.js
// ALLOWED_TRANSITIONS for the source of truth this UI just reflects.
let verificationRequest = null; // current request object (or null if not_started)
let verificationCameraStream = null; // active getUserMedia stream, torn down on step exit
let verificationRecordedBlob = null; // last-recorded liveness clip, held until submit

async function loadVerificationSection() {
  if (!viewedArtist) return;
  try {
    const res = await fetch(`${ARTISTS_BASE}/${encodeURIComponent(viewedArtist.id)}/verification/status`, { headers: authHeaders() });
    const data = await res.json();
    if (!res.ok) {
      if (res.status === 401) { handleTokenExpiry(); return; }
      throw new Error(data.error || 'Could not load verification status.');
    }
    if (data.activeRequest) {
      // Fetch full detail for the active request (status endpoint only returns a summary).
      const reqRes = await fetch(`/api/verification/${encodeURIComponent(data.activeRequest.id)}`, { headers: authHeaders() });
      const reqData = await reqRes.json();
      verificationRequest = reqRes.ok ? reqData : data.activeRequest;
    } else {
      verificationRequest = null;
    }
    renderVerificationSection(data);
  } catch (err) {
    console.error('[verification section]', err);
    $('verificationSectionBody').innerHTML = `<div class="empty-panel">Could not load verification status.</div>`;
  }
}

function renderVerificationSection(statusData) {
  const body = $('verificationSectionBody');
  if (!body) return;

  if (statusData.isVerified) {
    body.innerHTML = `
      <div class="dash-card" style="text-align:center;padding:28px 20px;">
        <div style="font-size:1.4rem;color:var(--accent3);margin-bottom:8px;">✓</div>
        <div style="font-family:'Unbounded',sans-serif;font-weight:700;font-size:0.6rem;margin-bottom:8px;">Verified Artist</div>
        <div style="font-size:0.46rem;color:var(--text-muted);line-height:1.6;max-width:360px;margin:0 auto 16px;">
          FREQ reviewed evidence that this page is controlled by the artist or an authorized representative.
        </div>
        <button onclick="openVerificationRevokeInfo()" style="background:none;border:1px solid var(--border);color:var(--text-dim);font-family:'Space Mono',monospace;font-size:0.4rem;padding:7px 12px;border-radius:var(--radius);cursor:pointer;">What could revoke this?</button>
      </div>`;
    return;
  }

  const status = verificationRequest?.status || 'not_started';

  if (status === 'not_started' || !verificationRequest) {
    body.innerHTML = verificationClaimIntroHtml();
    return;
  }
  if (status === 'email_pending') { body.innerHTML = verificationEmailPendingHtml(); return; }
  if (status === 'evidence_required' || status === 'more_information_required') { body.innerHTML = verificationEvidenceStepHtml(status); attachVerificationEvidenceHandlers(); return; }
  if (status === 'liveness_pending' || status === 'automated_review') { body.innerHTML = verificationProcessingHtml('Running automated checks…'); return; }
  if (status === 'manual_review') { body.innerHTML = verificationManualReviewHtml(); return; }
  if (status === 'approved') { body.innerHTML = verificationProcessingHtml('Approved — refreshing…'); loadVerificationSection(); return; }
  if (status === 'rejected') { body.innerHTML = verificationRejectedHtml(); return; }
  if (status === 'revoked') { body.innerHTML = verificationRevokedHtml(); return; }
  if (status === 'expired') { body.innerHTML = verificationClaimIntroHtml(true); return; }
}

function verificationClaimIntroHtml(wasExpired) {
  return `
    <div class="dash-card">
      ${wasExpired ? `<div style="color:var(--accent2);font-size:0.44rem;margin-bottom:10px;">Your previous verification attempt expired. You can start again below.</div>` : ''}
      <div style="font-size:0.48rem;color:var(--text-muted);line-height:1.7;margin-bottom:16px;">
        Get a verification badge to show fans this page is really you (or your official team).
        FREQ reviews your evidence — legal identity, ownership of the artist identity, and a short
        liveness check — before any badge is granted. Nothing here is decided automatically;
        a human reviews every request.
      </div>
      <label style="display:block;font-size:0.42rem;color:var(--text-dim);letter-spacing:0.04em;text-transform:uppercase;margin-bottom:5px;">Your Role</label>
      <select id="vClaimRole" style="width:100%;background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:var(--radius);color:var(--text-main);font-family:'Space Mono',monospace;font-size:0.5rem;padding:9px 11px;box-sizing:border-box;margin-bottom:12px;">
        <option value="artist">I am the artist</option>
        <option value="manager">I am their manager</option>
        <option value="label_rep">I am a label representative</option>
        <option value="authorized_team_member">I am an authorized team member</option>
      </select>
      <label style="display:block;font-size:0.42rem;color:var(--text-dim);letter-spacing:0.04em;text-transform:uppercase;margin-bottom:5px;">Legal Name</label>
      <input type="text" id="vClaimLegalName" maxlength="200" placeholder="As shown on your government ID" style="width:100%;background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:var(--radius);color:var(--text-main);font-family:'Space Mono',monospace;font-size:0.5rem;padding:9px 11px;box-sizing:border-box;margin-bottom:12px;" />
      <label style="display:block;font-size:0.42rem;color:var(--text-dim);letter-spacing:0.04em;text-transform:uppercase;margin-bottom:5px;">Stage Name (optional, if different)</label>
      <input type="text" id="vClaimStageName" maxlength="200" style="width:100%;background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:var(--radius);color:var(--text-main);font-family:'Space Mono',monospace;font-size:0.5rem;padding:9px 11px;box-sizing:border-box;margin-bottom:12px;" />
      <label style="display:block;font-size:0.42rem;color:var(--text-dim);letter-spacing:0.04em;text-transform:uppercase;margin-bottom:5px;">Contact Email</label>
      <input type="email" id="vClaimEmail" maxlength="255" placeholder="Prefer your official/label email if you have one" style="width:100%;background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:var(--radius);color:var(--text-main);font-family:'Space Mono',monospace;font-size:0.5rem;padding:9px 11px;box-sizing:border-box;margin-bottom:12px;" />
      <label style="display:block;font-size:0.42rem;color:var(--text-dim);letter-spacing:0.04em;text-transform:uppercase;margin-bottom:5px;">Official Links (website, socials — one per line)</label>
      <textarea id="vClaimLinks" rows="3" placeholder="https://…" style="width:100%;background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:var(--radius);color:var(--text-main);font-family:'Space Mono',monospace;font-size:0.48rem;padding:9px 11px;box-sizing:border-box;resize:vertical;margin-bottom:14px;"></textarea>
      <div id="vClaimStatus" style="font-size:0.42rem;color:var(--accent2);margin-bottom:10px;min-height:1.2em;"></div>
      <button id="vClaimSubmitBtn" onclick="submitVerificationClaim()" style="background:var(--accent);color:var(--bg);border:none;font-family:'Unbounded',sans-serif;font-weight:700;font-size:0.48rem;padding:10px 18px;border-radius:var(--radius);cursor:pointer;letter-spacing:0.04em;text-transform:uppercase;">Start Verification</button>
    </div>`;
}

async function submitVerificationClaim() {
  const btn = $('vClaimSubmitBtn');
  const roleEl = $('vClaimRole'), legalEl = $('vClaimLegalName'), emailEl = $('vClaimEmail');
  const legalName = legalEl.value.trim(), contactEmail = emailEl.value.trim();
  if (!legalName) { $('vClaimStatus').textContent = 'Legal name is required.'; return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) { $('vClaimStatus').textContent = 'Enter a valid contact email.'; return; }
  const links = $('vClaimLinks').value.split('\n').map(l => l.trim()).filter(Boolean);

  btn.disabled = true; btn.textContent = 'Starting…';
  $('vClaimStatus').textContent = '';
  try {
    const res = await fetch(`${ARTISTS_BASE}/${encodeURIComponent(viewedArtist.id)}/verification/start`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: AUTH.token, role: roleEl.value, legalName, stageName: $('vClaimStageName').value.trim(),
        contactEmail, officialLinks: links,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      if (res.status === 401) { handleTokenExpiry(); return; }
      throw new Error(data.error || 'Could not start verification.');
    }

    // Backend generated + stored the token; it hands back the real link so
    // WE send it (real browser context — EmailJS's API blocks server-side
    // calls unless "non-browser applications" is explicitly enabled on the
    // account, which is why this moved to the frontend).
    try {
      await emailjs.send(
        FREQ_VERIFICATION_EMAILJS.SERVICE_ID,
        FREQ_VERIFICATION_EMAILJS.TEMPLATE_ID,
        {
          email: data.contactEmail || contactEmail,
          artistName: data.artistName || 'there',
          verifyUrl: data.verifyUrl,
          expiresInHours: String(data.expiresInHours || 24),
        },
        { publicKey: FREQ_VERIFICATION_EMAILJS.PUBLIC_KEY }
      );
    } catch (emailErr) {
      console.error('[verification email] EmailJS send failed:', emailErr);
      // Request already exists server-side at this point — don't block the
      // user on a delivery hiccup, just tell them plainly and let "Check
      // Again" / a resend action retry later rather than losing the request.
      showToast('Started, but email may not have sent', 'You can retry from the pending screen.', 'warning');
      await loadVerificationSection();
      return;
    }

    showToast('Verification started', 'Check your email to confirm your address.', 'success');
    await loadVerificationSection();
  } catch (err) {
    $('vClaimStatus').textContent = err.message;
    btn.disabled = false; btn.textContent = 'Start Verification';
  }
}

function verificationEmailPendingHtml() {
  return `
    <div class="dash-card" style="text-align:center;padding:24px 20px;">
      <div style="font-size:0.48rem;color:var(--text-muted);line-height:1.7;margin-bottom:14px;">
        We sent a confirmation link to <strong style="color:var(--text-main);">${escapeHtml(verificationRequest?.contactEmail || 'your email')}</strong>.
        Click the link to continue. This page will update automatically once you confirm.
      </div>
      <div id="vResendStatus" style="font-size:0.42rem;color:var(--accent);min-height:14px;margin-bottom:8px;"></div>
      <div style="display:flex;gap:8px;justify-content:center;">
        <button onclick="loadVerificationSection()" style="background:none;border:1px solid var(--border);color:var(--text-dim);font-family:'Space Mono',monospace;font-size:0.42rem;padding:7px 14px;border-radius:var(--radius);cursor:pointer;">↻ Check Again</button>
        <button id="vResendBtn" onclick="resendVerificationEmail()" style="background:none;border:1px solid var(--accent);color:var(--accent);font-family:'Space Mono',monospace;font-size:0.42rem;padding:7px 14px;border-radius:var(--radius);cursor:pointer;">✉ Resend Email</button>
      </div>
    </div>`;
}

// Regenerates the token/link server-side (old link is invalidated) then
// sends it the same way submitVerificationClaim() does — client-side via
// emailjs.send(), since that's the path that actually works (EmailJS blocks
// server-side/non-browser API calls by default).
async function resendVerificationEmail() {
  const btn = $('vResendBtn');
  const statusEl = $('vResendStatus');
  if (!verificationRequest?.id) return;
  btn.disabled = true; btn.textContent = 'Sending…';
  statusEl.textContent = '';
  try {
    const res = await fetch(`/api/verification/${encodeURIComponent(verificationRequest.id)}/resend-email`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: AUTH.token }),
    });
    const data = await res.json();
    if (!res.ok) {
      if (res.status === 401) { handleTokenExpiry(); return; }
      throw new Error(data.error || 'Could not resend email.');
    }

    await emailjs.send(
      FREQ_VERIFICATION_EMAILJS.SERVICE_ID,
      FREQ_VERIFICATION_EMAILJS.TEMPLATE_ID,
      {
        email: data.contactEmail,
        artistName: data.artistName || 'there',
        verifyUrl: data.verifyUrl,
        expiresInHours: String(data.expiresInHours || 24),
      },
      { publicKey: FREQ_VERIFICATION_EMAILJS.PUBLIC_KEY }
    );

    statusEl.textContent = '✓ Sent! Check your inbox (and spam folder).';
    statusEl.style.color = 'var(--accent)';
  } catch (err) {
    console.error('[verification resend]', err);
    statusEl.textContent = err.message || 'Could not resend — try again in a moment.';
    statusEl.style.color = 'var(--accent2)';
  } finally {
    btn.disabled = false; btn.textContent = '✉ Resend Email';
  }
}

function verificationProcessingHtml(label) {
  return `<div class="dash-card" style="text-align:center;padding:28px 20px;">
    <div style="font-size:0.48rem;color:var(--text-muted);">${escapeHtml(label)}</div>
  </div>`;
}

function verificationManualReviewHtml() {
  return `
    <div class="dash-card" style="text-align:center;padding:24px 20px;">
      <div style="font-size:0.48rem;color:var(--text-muted);line-height:1.7;margin-bottom:10px;">
        Your evidence is in — a FREQ reviewer will look it over. This usually takes a few days.
        We'll email you once there's a decision.
      </div>
      <button onclick="loadVerificationSection()" style="background:none;border:1px solid var(--border);color:var(--text-dim);font-family:'Space Mono',monospace;font-size:0.42rem;padding:7px 14px;border-radius:var(--radius);cursor:pointer;">↻ Check Status</button>
    </div>`;
}

function verificationRejectedHtml() {
  const reason = verificationRequest?.decisionReason;
  return `
    <div class="dash-card">
      <div style="color:var(--accent2);font-size:0.5rem;font-weight:700;margin-bottom:8px;">Not Approved</div>
      ${reason ? `<div style="font-size:0.46rem;color:var(--text-muted);margin-bottom:14px;line-height:1.6;">${escapeHtml(reason)}</div>` : ''}
      <button onclick="submitVerificationAppeal()" style="background:var(--accent);color:var(--bg);border:none;font-family:'Unbounded',sans-serif;font-weight:700;font-size:0.46rem;padding:9px 16px;border-radius:var(--radius);cursor:pointer;letter-spacing:0.04em;text-transform:uppercase;">Submit an Appeal</button>
    </div>`;
}

function verificationRevokedHtml() {
  const reason = verificationRequest?.decisionReason;
  return `
    <div class="dash-card">
      <div style="color:var(--accent2);font-size:0.5rem;font-weight:700;margin-bottom:8px;">Badge Revoked</div>
      ${reason ? `<div style="font-size:0.46rem;color:var(--text-muted);margin-bottom:14px;line-height:1.6;">${escapeHtml(reason)}</div>` : ''}
      <div style="font-size:0.44rem;color:var(--text-dim);">Contact support if you believe this was a mistake.</div>
    </div>`;
}

async function submitVerificationAppeal() {
  if (!verificationRequest) return;
  try {
    const res = await fetch(`/api/verification/${encodeURIComponent(verificationRequest.id)}/appeal`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: AUTH.token }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not submit appeal.');

    // Same reasoning as submitVerificationClaim(): backend generated + stored
    // the token, hands back the real link, WE send it client-side since
    // that's the browser context EmailJS's free-tier API requires.
    try {
      await emailjs.send(
        FREQ_VERIFICATION_EMAILJS.SERVICE_ID,
        FREQ_VERIFICATION_EMAILJS.TEMPLATE_ID,
        {
          email: data.contactEmail,
          artistName: data.artistName || 'there',
          verifyUrl: data.verifyUrl,
          expiresInHours: String(data.expiresInHours || 24),
        },
        { publicKey: FREQ_VERIFICATION_EMAILJS.PUBLIC_KEY }
      );
    } catch (emailErr) {
      console.error('[verification appeal email] EmailJS send failed:', emailErr);
      showToast('Appeal submitted, but email may not have sent', 'You can retry from the pending screen.', 'warning');
      await loadVerificationSection();
      return;
    }

    showToast('Appeal submitted', 'Please confirm your email again to continue.', 'success');
    await loadVerificationSection();
  } catch (err) {
    showToast('Error', err.message, 'error');
  }
}

function openVerificationRevokeInfo() {
  showToast('Verification', 'Badges can be revoked if evidence of fraud is found, or on request.', 'info');
}

// ── Evidence step: consent -> ID -> selfie -> liveness -> ownership ────────
let verificationEvidenceSubstep = 'consent'; // consent | id | selfie | liveness | ownership

function verificationEvidenceStepHtml(status) {
  const req = verificationRequest || {};
  if (!req.consentGivenAt) verificationEvidenceSubstep = 'consent';
  else if (!req.hasIdDocument) verificationEvidenceSubstep = 'id';
  else if (!req.hasSelfie) verificationEvidenceSubstep = 'selfie';
  else if (!req.hasLivenessVideo) verificationEvidenceSubstep = 'liveness';
  else verificationEvidenceSubstep = 'ownership';

  const moreInfoBanner = status === 'more_information_required'
    ? `<div style="background:rgba(255,150,60,0.08);border:1px solid var(--accent2);border-radius:var(--radius);padding:10px 12px;font-size:0.44rem;color:var(--text-main);margin-bottom:14px;">A reviewer requested more information. Please review and resubmit the steps below.</div>`
    : '';

  const steps = [
    { key: 'consent', label: 'Consent' }, { key: 'id', label: 'ID Document' },
    { key: 'selfie', label: 'Selfie' }, { key: 'liveness', label: 'Liveness Video' },
    { key: 'ownership', label: 'Ownership Proof' },
  ];
  const stepper = `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px;">${steps.map(s => {
    const done = stepIsDone(s.key, req);
    const active = s.key === verificationEvidenceSubstep;
    const color = done ? 'var(--accent3)' : active ? 'var(--accent)' : 'var(--text-dim)';
    return `<div style="font-size:0.38rem;padding:4px 8px;border:1px solid ${active ? 'var(--accent)' : 'var(--border)'};border-radius:var(--radius);color:${color};">${done ? '✓ ' : ''}${s.label}</div>`;
  }).join('')}</div>`;

  let content = '';
  if (verificationEvidenceSubstep === 'consent') content = verificationConsentHtml();
  else if (verificationEvidenceSubstep === 'id') content = verificationCaptureHtml('id', 'Government-Issued ID', 'Upload a clear photo of your government-issued ID. Stage names may differ from your legal name — that\'s expected.');
  else if (verificationEvidenceSubstep === 'selfie') content = verificationCaptureHtml('selfie', 'Live Selfie', 'Use your camera to take a live selfie. Gallery photos aren\'t accepted for this step.');
  else if (verificationEvidenceSubstep === 'liveness') { content = verificationLivenessHtml(); setTimeout(fetchVerificationLivenessPrompt, 0); }
  else if (verificationEvidenceSubstep === 'ownership') content = verificationOwnershipHtml();

  return `<div class="dash-card">${moreInfoBanner}${stepper}${content}</div>`;
}

function stepIsDone(key, req) {
  if (key === 'consent') return !!req.consentGivenAt;
  if (key === 'id') return !!req.hasIdDocument;
  if (key === 'selfie') return !!req.hasSelfie;
  if (key === 'liveness') return !!req.hasLivenessVideo;
  if (key === 'ownership') return !!req.ownershipVerifiedAt || !!req.ownershipEvidenceType;
  return false;
}

function verificationConsentHtml() {
  return `
    <div style="font-size:0.46rem;color:var(--text-muted);line-height:1.7;margin-bottom:14px;">
      <strong style="color:var(--text-main);">Before continuing, here's what we collect and why:</strong><br/><br/>
      • A photo of your government ID, a live selfie, and a short liveness video<br/>
      • Used only to confirm you control this artist page — never for ads, AI training, or recommendations<br/>
      • Reviewed by FREQ staff; automated checks are advisory signals only, never a final decision<br/>
      • Encrypted at rest, access-logged, and deleted once no longer needed (you can request earlier deletion)<br/>
      • A non-biometric alternative may be available — contact support if you'd prefer that route
    </div>
    <label style="display:flex;gap:8px;align-items:flex-start;font-size:0.44rem;color:var(--text-main);margin-bottom:14px;cursor:pointer;">
      <input type="checkbox" id="vConsentCheckbox" style="margin-top:2px;" />
      <span>I understand and consent to this biometric/identity data collection for the purpose of artist verification.</span>
    </label>
    <button id="vConsentBtn" onclick="submitVerificationConsent()" style="background:var(--accent);color:var(--bg);border:none;font-family:'Unbounded',sans-serif;font-weight:700;font-size:0.46rem;padding:9px 16px;border-radius:var(--radius);cursor:pointer;letter-spacing:0.04em;text-transform:uppercase;">Continue</button>
    <div id="vConsentStatus" style="font-size:0.42rem;color:var(--accent2);margin-top:8px;"></div>`;
}

async function submitVerificationConsent() {
  if (!$('vConsentCheckbox').checked) { $('vConsentStatus').textContent = 'Please check the box to continue.'; return; }
  const btn = $('vConsentBtn'); btn.disabled = true;
  try {
    const res = await fetch(`/api/verification/${encodeURIComponent(verificationRequest.id)}/consent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: AUTH.token, consentGiven: true }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not record consent.');
    verificationRequest.consentGivenAt = data.consentGivenAt;
    verificationEvidenceSubstep = 'id';
    renderVerificationSection({ isVerified: false });
  } catch (err) {
    $('vConsentStatus').textContent = err.message;
    btn.disabled = false;
  }
}

// ── ID + selfie capture (camera-only for selfie; file picker for ID) ───────
function verificationCaptureHtml(kind, title, description) {
  const isSelfie = kind === 'selfie';
  return `
    <div style="font-family:'Unbounded',sans-serif;font-weight:700;font-size:0.5rem;margin-bottom:6px;">${title}</div>
    <div style="font-size:0.44rem;color:var(--text-muted);margin-bottom:12px;line-height:1.6;">${description}</div>
    ${isSelfie
      ? `<video id="vCamPreview" autoplay playsinline muted style="width:100%;max-width:320px;border-radius:var(--radius);background:#000;margin-bottom:10px;display:block;"></video>
         <canvas id="vCamCanvas" style="display:none;"></canvas>
         <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
           <button onclick="startVerificationCamera()" style="background:none;border:1px solid var(--border);color:var(--text-muted);font-family:'Space Mono',monospace;font-size:0.42rem;padding:7px 12px;border-radius:var(--radius);cursor:pointer;">▶ Start Camera</button>
           <button onclick="captureVerificationSelfie()" style="background:var(--accent);color:var(--bg);border:none;font-family:'Space Mono',monospace;font-weight:700;font-size:0.42rem;padding:7px 12px;border-radius:var(--radius);cursor:pointer;">📷 Capture</button>
         </div>`
      : `<input type="file" id="vIdFileInput" accept="image/png,image/jpeg,image/webp" style="width:100%;font-size:0.44rem;color:var(--text-muted);margin-bottom:10px;" />`
    }
    <div id="vCaptureStatus" style="font-size:0.42rem;color:var(--accent2);margin-bottom:8px;min-height:1.2em;"></div>
    <button id="vCaptureSubmitBtn" onclick="submitVerificationCapture('${kind}')" style="background:var(--accent);color:var(--bg);border:none;font-family:'Unbounded',sans-serif;font-weight:700;font-size:0.46rem;padding:9px 16px;border-radius:var(--radius);cursor:pointer;letter-spacing:0.04em;text-transform:uppercase;">Upload &amp; Continue</button>`;
}

function attachVerificationEvidenceHandlers() {
  // Camera lifecycle is handled by startVerificationCamera/captureVerificationSelfie
  // directly (called from onclick), so nothing to wire up here beyond re-render —
  // kept as a named hook in case future substeps need init-on-mount behavior.
}

async function startVerificationCamera() {
  try {
    verificationCameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
    const video = $('vCamPreview');
    if (video) { video.srcObject = verificationCameraStream; }
  } catch (err) {
    $('vCaptureStatus').textContent = 'Could not access camera: ' + err.message;
  }
}

function stopVerificationCamera() {
  if (verificationCameraStream) {
    verificationCameraStream.getTracks().forEach(t => t.stop());
    verificationCameraStream = null;
  }
}

let verificationCapturedSelfieBlob = null;
function captureVerificationSelfie() {
  const video = $('vCamPreview'), canvas = $('vCamCanvas');
  if (!video || !video.srcObject) { $('vCaptureStatus').textContent = 'Start the camera first.'; return; }
  canvas.width = video.videoWidth; canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  canvas.toBlob(blob => {
    verificationCapturedSelfieBlob = blob;
    $('vCaptureStatus').textContent = 'Selfie captured. Click "Upload & Continue" to submit.';
    $('vCaptureStatus').style.color = 'var(--accent3)';
  }, 'image/jpeg', 0.9);
}

async function submitVerificationCapture(kind) {
  const btn = $('vCaptureSubmitBtn');
  let file;
  if (kind === 'selfie') {
    if (!verificationCapturedSelfieBlob) { $('vCaptureStatus').textContent = 'Capture a selfie first.'; return; }
    file = verificationCapturedSelfieBlob;
  } else {
    const input = $('vIdFileInput');
    if (!input?.files?.[0]) { $('vCaptureStatus').textContent = 'Choose a file first.'; return; }
    file = input.files[0];
  }
  btn.disabled = true; btn.textContent = 'Uploading…';
  try {
    const formData = new FormData();
    formData.append('token', AUTH.token);
    formData.append('file', file, kind === 'selfie' ? 'selfie.jpg' : 'id-document');
    const endpoint = kind === 'selfie' ? 'documents/selfie' : 'documents/id';
    const res = await fetch(`/api/verification/${encodeURIComponent(verificationRequest.id)}/${endpoint}`, { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Upload failed.');
    stopVerificationCamera();
    if (kind === 'selfie') verificationRequest.hasSelfie = true; else verificationRequest.hasIdDocument = true;
    showToast('Uploaded', `${kind === 'selfie' ? 'Selfie' : 'ID document'} received.`, 'success');
    await loadVerificationSection();
  } catch (err) {
    $('vCaptureStatus').textContent = err.message;
    btn.disabled = false; btn.textContent = 'Upload & Continue';
  }
}

// ── Liveness video: fetch a fresh random prompt, record, upload ────────────
let verificationLivenessPrompt = null;
let verificationMediaRecorder = null;
let verificationRecordedChunks = [];

function verificationLivenessHtml() {
  return `
    <div style="font-family:'Unbounded',sans-serif;font-weight:700;font-size:0.5rem;margin-bottom:6px;">Liveness Video</div>
    <div style="font-size:0.44rem;color:var(--text-muted);margin-bottom:12px;line-height:1.6;">
      Record a few seconds of video following the prompt below. A new prompt is issued each attempt.
    </div>
    <div id="vLivenessPrompt" style="font-size:0.5rem;color:var(--accent);font-weight:700;margin-bottom:10px;padding:10px;border:1px solid var(--border);border-radius:var(--radius);text-align:center;">Fetching prompt…</div>
    <video id="vLiveCamPreview" autoplay playsinline muted style="width:100%;max-width:320px;border-radius:var(--radius);background:#000;margin-bottom:10px;display:block;"></video>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
      <button onclick="startVerificationLivenessCamera()" style="background:none;border:1px solid var(--border);color:var(--text-muted);font-family:'Space Mono',monospace;font-size:0.42rem;padding:7px 12px;border-radius:var(--radius);cursor:pointer;">▶ Start Camera</button>
      <button id="vLiveRecordBtn" onclick="toggleVerificationRecording()" style="background:var(--accent2);color:#fff;border:none;font-family:'Space Mono',monospace;font-weight:700;font-size:0.42rem;padding:7px 12px;border-radius:var(--radius);cursor:pointer;">● Record</button>
    </div>
    <div id="vCaptureStatus" style="font-size:0.42rem;color:var(--accent2);margin-bottom:8px;min-height:1.2em;"></div>
    <button id="vCaptureSubmitBtn" onclick="submitVerificationLiveness()" style="background:var(--accent);color:var(--bg);border:none;font-family:'Unbounded',sans-serif;font-weight:700;font-size:0.46rem;padding:9px 16px;border-radius:var(--radius);cursor:pointer;letter-spacing:0.04em;text-transform:uppercase;">Upload &amp; Continue</button>`;
}

async function fetchVerificationLivenessPrompt() {
  try {
    const res = await fetch(`/api/verification/${encodeURIComponent(verificationRequest.id)}/liveness/prompt?token=${encodeURIComponent(AUTH.token)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not fetch prompt.');
    verificationLivenessPrompt = data.prompt;
    const el = $('vLivenessPrompt');
    if (el) el.textContent = data.prompt.label;
  } catch (err) {
    const el = $('vLivenessPrompt');
    if (el) el.textContent = 'Could not load prompt — try refreshing.';
  }
}

async function startVerificationLivenessCamera() {
  try {
    verificationCameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
    const video = $('vLiveCamPreview');
    if (video) video.srcObject = verificationCameraStream;
    if (!verificationLivenessPrompt) fetchVerificationLivenessPrompt();
  } catch (err) {
    $('vCaptureStatus').textContent = 'Could not access camera: ' + err.message;
  }
}

function toggleVerificationRecording() {
  const btn = $('vLiveRecordBtn');
  if (!verificationMediaRecorder || verificationMediaRecorder.state === 'inactive') {
    if (!verificationCameraStream) { $('vCaptureStatus').textContent = 'Start the camera first.'; return; }
    verificationRecordedChunks = [];
    verificationMediaRecorder = new MediaRecorder(verificationCameraStream, { mimeType: 'video/webm' });
    verificationMediaRecorder.ondataavailable = e => { if (e.data.size > 0) verificationRecordedChunks.push(e.data); };
    verificationMediaRecorder.onstop = () => {
      verificationRecordedBlob = new Blob(verificationRecordedChunks, { type: 'video/webm' });
      $('vCaptureStatus').textContent = 'Clip recorded. Click "Upload & Continue" to submit.';
      $('vCaptureStatus').style.color = 'var(--accent3)';
    };
    verificationMediaRecorder.start();
    btn.textContent = '■ Stop';
    // Auto-stop after 8 seconds so nobody has to guess how long is enough.
    setTimeout(() => { if (verificationMediaRecorder?.state === 'recording') verificationMediaRecorder.stop(); btn.textContent = '● Record'; }, 8000);
  } else {
    verificationMediaRecorder.stop();
    btn.textContent = '● Record';
  }
}

async function submitVerificationLiveness() {
  if (!verificationRecordedBlob) { $('vCaptureStatus').textContent = 'Record a clip first.'; return; }
  const btn = $('vCaptureSubmitBtn');
  btn.disabled = true; btn.textContent = 'Uploading…';
  try {
    const formData = new FormData();
    formData.append('token', AUTH.token);
    formData.append('file', verificationRecordedBlob, 'liveness.webm');
    const res = await fetch(`/api/verification/${encodeURIComponent(verificationRequest.id)}/liveness/submit`, { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Upload failed.');
    stopVerificationCamera();
    verificationRecordedBlob = null;
    showToast('Submitted', 'Automated checks are running — this may take a moment.', 'success');
    await loadVerificationSection();
  } catch (err) {
    $('vCaptureStatus').textContent = err.message;
    btn.disabled = false; btn.textContent = 'Upload & Continue';
  }
}

// ── Ownership evidence (Step 7) ─────────────────────────────────────────────
function verificationOwnershipHtml() {
  const existing = verificationRequest?.ownershipEvidenceType;
  return `
    <div style="font-family:'Unbounded',sans-serif;font-weight:700;font-size:0.5rem;margin-bottom:6px;">Prove You Control This Page</div>
    <div style="font-size:0.44rem;color:var(--text-muted);margin-bottom:12px;line-height:1.6;">
      Identity evidence alone doesn't prove you control this specific artist page — pick one way to show that:
    </div>
    <select id="vOwnershipType" style="width:100%;background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:var(--radius);color:var(--text-main);font-family:'Space Mono',monospace;font-size:0.48rem;padding:9px 11px;box-sizing:border-box;margin-bottom:10px;">
      <option value="website_code">Add a code to my official website</option>
      <option value="social_code">Add a code to a verified social profile</option>
      <option value="official_email_reply">Reply from an official label/management email</option>
      <option value="distributor_link">Link an official distributor/label account</option>
      <option value="authorization_doc">Provide representative authorization documentation</option>
      <option value="verified_collaborator_confirm">Confirm via an already-verified collaborator</option>
    </select>
    <div id="vOwnershipDynamic"></div>
    <div id="vCaptureStatus" style="font-size:0.42rem;color:var(--accent2);margin:8px 0;min-height:1.2em;"></div>
    <button id="vOwnershipSubmitBtn" onclick="submitVerificationOwnership()" style="background:var(--accent);color:var(--bg);border:none;font-family:'Unbounded',sans-serif;font-weight:700;font-size:0.46rem;padding:9px 16px;border-radius:var(--radius);cursor:pointer;letter-spacing:0.04em;text-transform:uppercase;">Submit</button>
    ${existing ? `<div style="font-size:0.4rem;color:var(--text-dim);margin-top:8px;">Previously submitted: ${escapeHtml(existing)}</div>` : ''}`;
}

$('artistDashboardOverlay')?.addEventListener('change', e => {
  if (e.target?.id === 'vOwnershipType') renderVerificationOwnershipDynamicField();
});
function renderVerificationOwnershipDynamicField() {
  const type = $('vOwnershipType')?.value;
  const el = $('vOwnershipDynamic');
  if (!el) return;
  if (type === 'website_code' || type === 'social_code') {
    el.innerHTML = `<input type="text" id="vOwnershipUrl" placeholder="https://…" style="width:100%;background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:var(--radius);color:var(--text-main);font-family:'Space Mono',monospace;font-size:0.48rem;padding:9px 11px;box-sizing:border-box;margin-bottom:6px;" />`;
  } else {
    el.innerHTML = `<textarea id="vOwnershipDetail" rows="2" placeholder="Add any context (contact used, account link, etc.)" style="width:100%;background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:var(--radius);color:var(--text-main);font-family:'Space Mono',monospace;font-size:0.46rem;padding:9px 11px;box-sizing:border-box;resize:vertical;margin-bottom:6px;"></textarea>`;
  }
}

async function submitVerificationOwnership() {
  const type = $('vOwnershipType')?.value;
  const btn = $('vOwnershipSubmitBtn');
  btn.disabled = true;
  try {
    const body = { token: AUTH.token, evidenceType: type };
    if (type === 'website_code' || type === 'social_code') body.url = $('vOwnershipUrl')?.value.trim();
    else body.detail = { note: $('vOwnershipDetail')?.value.trim() };

    const res = await fetch(`/api/verification/${encodeURIComponent(verificationRequest.id)}/ownership-evidence`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not submit evidence.');

    if (data.issuedCode) {
      $('vCaptureStatus').style.color = 'var(--accent3)';
      $('vCaptureStatus').textContent = `Add this code to your site, then click Submit again: ${data.issuedCode}`;
      btn.disabled = false;
      return;
    }
    if (data.autoVerified) {
      showToast('Verified', 'Ownership evidence confirmed.', 'success');
    } else {
      showToast('Submitted', 'A reviewer will confirm this evidence.', 'success');
    }
    await loadVerificationSection();
  } catch (err) {
    $('vCaptureStatus').textContent = err.message;
    btn.disabled = false;
  }
}
