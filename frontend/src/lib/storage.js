const DEPLOYMENT_KEY = "attendance_deployment_v1";

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function loadDeployment() {
  const raw = localStorage.getItem(DEPLOYMENT_KEY);
  if (!raw) return null;
  return safeJsonParse(raw);
}

export function saveDeployment(data) {
  localStorage.setItem(DEPLOYMENT_KEY, JSON.stringify(data));
}

export function clearDeployment() {
  localStorage.removeItem(DEPLOYMENT_KEY);
}

export function makeAddressBookKey(chainId, classId) {
  return `attendance_cert_cache_v1:${chainId}:${classId}`;
}

// Very small helper for demo: store last known certificate tokenId per student.
export function loadStudentCertificateTokenId(chainId, classId, student) {
  const key = makeAddressBookKey(chainId, classId);
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  const parsed = safeJsonParse(raw);
  if (!parsed) return null;
  const normalized = (student || "").toLowerCase();
  return parsed[normalized] ?? null;
}

export function saveStudentCertificateTokenId(chainId, classId, student, tokenId) {
  const key = makeAddressBookKey(chainId, classId);
  const raw = localStorage.getItem(key);
  const parsed = safeJsonParse(raw) || {};
  const normalized = (student || "").toLowerCase();
  parsed[normalized] = tokenId.toString();
  localStorage.setItem(key, JSON.stringify(parsed));
}